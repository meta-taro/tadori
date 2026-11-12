import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Item } from '../domain/model.js'
import { ownersOf } from '../domain/people.js'
import { joinList, t } from '../i18n.js'
import { commitFiles, type CommitResult } from './git.js'
import { loadProject, PATHS, ProjectLoadError } from './repository.js'
import { removeRow, upsertRow } from './tsv.js'

/**
 * 案件の台帳と設定を書く（MCP の書く道具と画面が使う）。
 * どれも、書いたあとに案件を読み直し、読めなくなったら元に戻して断る（形の崩れた台帳を残さない）。
 * 書けたら commit する（push は人）。人の承認（approvals.tsv）を書く口は作らない。
 */

/** 書くのを断った（理由つき）。ファイルは元のまま */
export class WriteRefused extends Error {
  constructor(readonly problems: readonly string[]) {
    super(problems.join('\n'))
    this.name = 'WriteRefused'
  }
}

const MEMBERS = '.tadori/members.tsv'
const RULESETS = PATHS.rulesets
const DEFAULT_RULESET = 'rules.tsv'
/** git に入れないルールのファイル（範囲が local の分類のルール） */
const LOCAL_SUFFIX = '.local.tsv'
const LOCAL_RULESET = `rules${LOCAL_SUFFIX}`
const LOCAL_IGNORE = `${RULESETS}/.gitignore`

/** rulesets の中の *.local.tsv を git が見ないようにする（.gitignore を置き、それだけは commit する） */
async function ensureLocalIgnored(dir: string): Promise<void> {
  const current = await readOr(join(dir, LOCAL_IGNORE), '')
  if (current.split(/\r?\n/).includes(`*${LOCAL_SUFFIX}`)) return
  const next = `${current}${current && !current.endsWith('\n') ? '\n' : ''}# その人とエージェントの間だけのルール（git に入れない）\n*${LOCAL_SUFFIX}\n`
  await writeFile(join(dir, LOCAL_IGNORE), next, 'utf8')
  await commitFiles(dir, [LOCAL_IGNORE], t('Keep local rules out of git'))
}

const ID_PATTERN = /^[^\s#][^\t\r\n]{0,63}$/
const COLUMN_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,31}$/
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const isDay = (v: string) => DATE_PATTERN.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`))

async function readOr(path: string, fallback: string): Promise<string> {
  try {
    return await readFile(path, 'utf8')
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback
    throw error
  }
}

/** 書いて、案件を読み直す。読めなければ元に戻して断る。読めれば commit する */
async function writeChecked(dir: string, path: string, next: string, original: string | null, message: string): Promise<CommitResult> {
  await mkdir(dirname(join(dir, path)), { recursive: true })
  await writeFile(join(dir, path), next, 'utf8')
  try {
    await loadProject(dir)
  } catch (error: unknown) {
    if (original !== null) await writeFile(join(dir, path), original, 'utf8')
    if (error instanceof ProjectLoadError) throw new WriteRefused(error.problems)
    throw error
  }
  // ローカルのルールのファイルは commit しない（git に入れない約束）
  if (path.endsWith('.local.tsv')) return { committed: false, reason: t('Not committed: local rules stay on this PC') }
  return commitFiles(dir, [path], message)
}

/** ID を確かめる対象（言語ごとに文の形が違うので、対象ごとに 1 つの文にする） */
type IdTarget = 'item' | 'task' | 'rule' | 'member'

const BAD_ID: Readonly<Record<IdTarget, (id: string) => string>> = {
  item: id => t('The ledger row ID "{id}" cannot be used (IDs must not be empty, start with a space or #, or exceed 64 characters)', { id }),
  task: id => t('The WBS task ID "{id}" cannot be used (IDs must not be empty, start with a space or #, or exceed 64 characters)', { id }),
  rule: id => t('The rule ID "{id}" cannot be used (IDs must not be empty, start with a space or #, or exceed 64 characters)', { id }),
  member: id => t('The person ID "{id}" cannot be used (IDs must not be empty, start with a space or #, or exceed 64 characters)', { id }),
}

function checkId(id: string | undefined, target: IdTarget): string {
  const value = (id ?? '').trim()
  if (!ID_PATTERN.test(value)) throw new WriteRefused([BAD_ID[target](value)])
  return value
}

// ---- 台帳の行 ----

export interface ItemInput {
  readonly id: string
  readonly kind?: string
  readonly title?: string
  readonly source?: string
  readonly refs?: readonly string[]
  /** そのほかの列（例：change・short）。列が無ければ右端に足す */
  readonly fields?: Readonly<Record<string, string>>
}

/**
 * 台帳の行を足す（create）か直す。refs は台帳と WBS にある ID だけ。
 * synced を渡すと、正本から手元へ反映した日時とだれが（synced_at・synced_by 列）も書く。
 */
/**
 * 台帳（items.tsv）の外から読んだ行（WBS・md-business の検証シート）は、ここでは書かない。
 * 台帳に同じ ID の行を足すと正本が 2 つになるため。直すのは、その行が書かれている場所
 */
function refuseOutsideLedger(items: readonly Item[], id: string): void {
  const file = items.find(i => i.id === id)?.file
  if (file && file !== PATHS.items) throw new WriteRefused([t('{id} is read from {file}. Change it there (tadori does not write to that file)', { id, file })])
}

export async function saveItem(dir: string, input: ItemInput, { create, synced }: { create: boolean; synced?: { at: string; who: string } }): Promise<CommitResult> {
  const id = checkId(input.id, 'item')
  const project = await loadProject(dir)
  const exists = project.items.some(i => i.id === id)
  if (create && exists) throw new WriteRefused([t('{id} is already in the ledger (use update to change it)', { id })])
  if (!create && !exists) throw new WriteRefused([t('{id} is not in the ledger (use add to add it)', { id })])
  refuseOutsideLedger(project.items, id)
  if (create && !input.kind?.trim()) throw new WriteRefused([t('A new row needs a kind')])
  const known = new Set(project.items.map(i => i.id))
  const missing = (input.refs ?? []).filter(r => !known.has(r))
  if (missing.length) throw new WriteRefused([t('refs contains IDs that are not in the ledger: {ids} (do not link by guesswork; add those rows first)', { ids: joinList(missing) })])
  const badColumns = Object.keys(input.fields ?? {}).filter(c => !COLUMN_PATTERN.test(c) || ['id', 'kind', 'title', 'source', 'refs'].includes(c))
  if (badColumns.length) throw new WriteRefused([t('These column names cannot be used: {columns}', { columns: joinList(badColumns) })])

  const values: Record<string, string> = {
    ...(input.kind !== undefined ? { kind: input.kind } : {}),
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(input.source !== undefined ? { source: input.source } : {}),
    ...(input.refs !== undefined ? { refs: input.refs.join('、') } : {}),
    ...(input.fields ?? {}),
    ...(synced ? { synced_at: synced.at, synced_by: synced.who } : {}),
  }
  const original = await readFile(join(dir, PATHS.items), 'utf8')
  return writeChecked(dir, PATHS.items, upsertRow(original, 'id', id, values), original, create ? t('Add {id} to the ledger', { id }) : t('Edit {id} in the ledger', { id }))
}

/** 台帳の行を消す。ほかの行の refs や WBS の issue が指している行は、つながりが切れるので消さない */
export async function removeItem(dir: string, rawId: string): Promise<CommitResult> {
  const id = checkId(rawId, 'item')
  const project = await loadProject(dir)
  if (!project.items.some(i => i.id === id)) throw new WriteRefused([t('{id} is not in the ledger', { id })])
  refuseOutsideLedger(project.items, id)
  const referrers = [
    ...project.items.filter(i => i.refs.includes(id)).map(i => i.id),
    ...project.tasks.filter(t => t.issue === id).map(t => t.id),
  ]
  if (referrers.length) throw new WriteRefused([t('{id} is referenced by {referrers}. Fix those first', { id, referrers: joinList(referrers) })])
  const original = await readFile(join(dir, PATHS.items), 'utf8')
  const next = removeRow(original, 'id', id)
  if (next === null) throw new WriteRefused([t('{id} is not in {file} (use saveTask for WBS tasks)', { id, file: PATHS.items })])
  return writeChecked(dir, PATHS.items, next, original, t('Remove {id} from the ledger', { id }))
}

// ---- WBS の作業 ----

export interface TaskInput {
  readonly id: string
  readonly phase?: string
  readonly name?: string
  readonly start?: string
  readonly end?: string
  readonly status?: string
  readonly owner?: string
  readonly issue?: string
}

/** WBS の作業を足す（create）か直す。状態は設定にあるもの、工程は設定にあるもの、日付は YYYY-MM-DD */
export async function saveTask(dir: string, input: TaskInput, { create }: { create: boolean }): Promise<CommitResult> {
  const id = checkId(input.id, 'task')
  const project = await loadProject(dir)
  const exists = project.tasks.some(task => task.id === id)
  if (create && exists) throw new WriteRefused([t('{id} is already in the WBS', { id })])
  if (!create && !exists) throw new WriteRefused([t('{id} is not in the WBS', { id })])
  const problems: string[] = []
  if (input.status !== undefined && !project.statuses.some(s => s.id === input.status)) problems.push(t('The status "{status}" is not in the settings ({allowed})', { status: input.status, allowed: project.statuses.map(s => s.id).join(' / ') }))
  if (input.phase !== undefined && !project.phases.some(p => p.id === input.phase)) problems.push(t('The phase "{phase}" is not in the settings', { phase: input.phase }))
  for (const [label, value] of [['start', input.start], ['end', input.end]] as const) {
    if (value !== undefined && value !== '' && !isDay(value)) problems.push(t('The {label} date "{value}" must be written as YYYY-MM-DD', { label, value }))
  }
  if (input.issue && !project.items.some(i => i.id === input.issue)) problems.push(t('The issue "{issue}" is not in the ledger', { issue: input.issue }))
  if (create && (!input.phase || !input.name || !input.status)) problems.push(t('A new task needs phase, name and status'))
  if (problems.length) throw new WriteRefused(problems)

  const { id: _ignored, ...rest } = input
  const values = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)) as Record<string, string>
  const original = await readFile(join(dir, PATHS.wbs), 'utf8')
  return writeChecked(dir, PATHS.wbs, upsertRow(original, 'id', id, values), original, create ? t('Add {id} to the WBS', { id }) : t('Edit {id} in the WBS', { id }))
}

// ---- ルール ----

export interface RuleInput {
  readonly id: string
  readonly phase?: string
  readonly kind?: string
  readonly from?: string
  readonly to?: string
  readonly field?: string
  readonly only?: string
  /** allowed で使う、列に書いてよい値（「a|b」） */
  readonly values?: string
  /** 分類の ID（rule-groups.tsv の id）。空で外す */
  readonly group?: string
  readonly owner?: string
  readonly label?: string
  /** 効く節目の ID（「a|b」）。空で外す */
  readonly at?: string
  /** 節目で突きつけるチェック項目の文 */
  readonly check?: string
}

const RULE_HEADER = 'id\tphase\tkind\tfrom\tto\tfield\tonly\tvalues\tgroup\towner\tlabel\n'

/** ルールが書かれているファイル（無ければ null） */
async function rulesetOf(dir: string, id: string): Promise<string | null> {
  const files = (await readdir(join(dir, RULESETS))).filter(f => f.endsWith('.tsv')).sort()
  for (const file of files) {
    const text = await readFile(join(dir, RULESETS, file), 'utf8')
    if (text.split(/\r?\n/).some(line => line.split('\t')[0] === id)) return `${RULESETS}/${file}`
  }
  return null
}

/** ルールを足す（create。.tadori/rulesets/rules.tsv に足す）か、書かれているファイルのまま直す */
export async function saveRule(dir: string, input: RuleInput, { create }: { create: boolean }): Promise<CommitResult> {
  const id = checkId(input.id, 'rule')
  const project = await loadProject(dir)
  const exists = project.rules.some(r => r.id === id)
  if (create && exists) throw new WriteRefused([t('Rule {id} already exists', { id })])
  if (!create && !exists) throw new WriteRefused([t('Rule {id} does not exist', { id })])
  // 判定しない文のルール（note）だけは、工程を空にしてよい
  const kind = input.kind ?? project.rules.find(r => r.id === id)?.kind
  const phaseOptional = kind === 'note'
  if (input.phase && !project.phases.some(p => p.id === input.phase)) throw new WriteRefused([t('The phase "{phase}" is not in the settings', { phase: input.phase })])
  if (input.phase === '' && !phaseOptional) throw new WriteRefused([t('A rule that checks needs a phase (only "note" rules may leave it empty)')])
  if (create && ((!input.phase && !phaseOptional) || !input.kind || !input.label)) throw new WriteRefused([t('A new rule needs phase, kind and label (a "note" rule needs only kind and label)')])

  // 範囲が local の分類のルールは、git に入れないファイルに書く（その人とエージェントの間の約束は、チームの履歴に残さない）
  const isLocal = project.ruleGroups?.find(g => g.id === input.group)?.scope === 'local'
  const path = create ? `${RULESETS}/${isLocal ? LOCAL_RULESET : DEFAULT_RULESET}` : ((await rulesetOf(dir, id)) as string)
  if (path.endsWith(LOCAL_SUFFIX)) await ensureLocalIgnored(dir)
  const original = await readOr(join(dir, path), RULE_HEADER)
  const { id: _ignored, ...rest } = input
  const values = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)) as Record<string, string>
  return writeChecked(dir, path, upsertRow(original, 'id', id, values), original, create ? t('Add rule {id}', { id }) : t('Edit rule {id}', { id }))
}

export async function removeRule(dir: string, rawId: string): Promise<CommitResult> {
  const id = checkId(rawId, 'rule')
  const path = await rulesetOf(dir, id)
  if (!path) throw new WriteRefused([t('Rule {id} does not exist', { id })])
  const original = await readFile(join(dir, path), 'utf8')
  return writeChecked(dir, path, removeRow(original, 'id', id) as string, original, t('Remove rule {id}', { id }))
}

// ---- 人の表 ----

export interface MemberInput {
  readonly name: string
  readonly git?: string
  readonly roles?: readonly string[]
}

/** 人の表（.tadori/members.tsv）に足すか直す。表が無ければ作る */
export async function saveMember(dir: string, input: MemberInput): Promise<CommitResult> {
  const name = checkId(input.name, 'member')
  const original = await readOr(join(dir, MEMBERS), 'name\tgit\troles\n')
  const values: Record<string, string> = {
    ...(input.git !== undefined ? { git: input.git } : {}),
    ...(input.roles !== undefined ? { roles: input.roles.flatMap(r => ownersOf(r)).join('・') } : {}),
  }
  return writeChecked(dir, MEMBERS, upsertRow(original, 'name', name, values), null, t('Update {name} in the people table', { name }))
}

export async function removeMember(dir: string, rawName: string): Promise<CommitResult> {
  const name = checkId(rawName, 'member')
  const original = await readOr(join(dir, MEMBERS), '')
  const next = original ? removeRow(original, 'name', name) : null
  if (next === null) throw new WriteRefused([t('{name} is not in the people table', { name })])
  return writeChecked(dir, MEMBERS, next, original, t('Remove {name} from the people table', { name }))
}
