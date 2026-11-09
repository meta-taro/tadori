import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ownersOf } from '../domain/people.js'
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
  await writeFile(join(dir, path), next, 'utf8')
  try {
    await loadProject(dir)
  } catch (error: unknown) {
    if (original !== null) await writeFile(join(dir, path), original, 'utf8')
    if (error instanceof ProjectLoadError) throw new WriteRefused(error.problems)
    throw error
  }
  return commitFiles(dir, [path], message)
}

function checkId(id: string | undefined, what: string): string {
  const value = (id ?? '').trim()
  if (!ID_PATTERN.test(value)) throw new WriteRefused([`${what}の ID「${value}」は使えません（空・空白や # で始まる・64 文字を超える ID は不可）`])
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
export async function saveItem(dir: string, input: ItemInput, { create, synced }: { create: boolean; synced?: { at: string; who: string } }): Promise<CommitResult> {
  const id = checkId(input.id, '台帳の行')
  const project = await loadProject(dir)
  const exists = project.items.some(i => i.id === id)
  if (create && exists) throw new WriteRefused([`台帳に ${id} はもうあります（直すなら update で）`])
  if (!create && !exists) throw new WriteRefused([`台帳に ${id} はありません（足すなら add で）`])
  if (create && !input.kind?.trim()) throw new WriteRefused(['足す行には kind（種類）が要ります'])
  const known = new Set(project.items.map(i => i.id))
  const missing = (input.refs ?? []).filter(r => !known.has(r))
  if (missing.length) throw new WriteRefused([`refs に台帳に無い ID があります：${missing.join('・')}（推測でつながない。先にその行を足してください）`])
  const badColumns = Object.keys(input.fields ?? {}).filter(c => !COLUMN_PATTERN.test(c) || ['id', 'kind', 'title', 'source', 'refs'].includes(c))
  if (badColumns.length) throw new WriteRefused([`使えない列の名前です：${badColumns.join('・')}`])

  const values: Record<string, string> = {
    ...(input.kind !== undefined ? { kind: input.kind } : {}),
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(input.source !== undefined ? { source: input.source } : {}),
    ...(input.refs !== undefined ? { refs: input.refs.join('、') } : {}),
    ...(input.fields ?? {}),
    ...(synced ? { synced_at: synced.at, synced_by: synced.who } : {}),
  }
  const original = await readFile(join(dir, PATHS.items), 'utf8')
  return writeChecked(dir, PATHS.items, upsertRow(original, 'id', id, values), original, `台帳の ${id} を${create ? '足した' : '直した'}`)
}

/** 台帳の行を消す。ほかの行の refs や WBS の issue が指している行は、つながりが切れるので消さない */
export async function removeItem(dir: string, rawId: string): Promise<CommitResult> {
  const id = checkId(rawId, '台帳の行')
  const project = await loadProject(dir)
  if (!project.items.some(i => i.id === id)) throw new WriteRefused([`台帳に ${id} はありません`])
  const referrers = [
    ...project.items.filter(i => i.refs.includes(id)).map(i => i.id),
    ...project.tasks.filter(t => t.issue === id).map(t => t.id),
  ]
  if (referrers.length) throw new WriteRefused([`${id} は ${referrers.join('・')} から指されています。先にそちらを直してください`])
  const original = await readFile(join(dir, PATHS.items), 'utf8')
  const next = removeRow(original, 'id', id)
  if (next === null) throw new WriteRefused([`${id} は ${PATHS.items} にありません（WBS の作業は saveTask で）`])
  return writeChecked(dir, PATHS.items, next, original, `台帳の ${id} を消した`)
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
  const id = checkId(input.id, 'WBS の作業')
  const project = await loadProject(dir)
  const exists = project.tasks.some(t => t.id === id)
  if (create && exists) throw new WriteRefused([`WBS に ${id} はもうあります`])
  if (!create && !exists) throw new WriteRefused([`WBS に ${id} はありません`])
  const problems: string[] = []
  if (input.status !== undefined && !project.statuses.some(s => s.id === input.status)) problems.push(`状態「${input.status}」は設定にありません（${project.statuses.map(s => s.id).join(' / ')}）`)
  if (input.phase !== undefined && !project.phases.some(p => p.id === input.phase)) problems.push(`工程「${input.phase}」は設定にありません`)
  for (const [label, value] of [['start', input.start], ['end', input.end]] as const) {
    if (value !== undefined && value !== '' && !isDay(value)) problems.push(`${label} の日付「${value}」は YYYY-MM-DD で書いてください`)
  }
  if (input.issue && !project.items.some(i => i.id === input.issue)) problems.push(`課題「${input.issue}」は台帳にありません`)
  if (create && (!input.phase || !input.name || !input.status)) problems.push('足す作業には phase・name・status が要ります')
  if (problems.length) throw new WriteRefused(problems)

  const { id: _ignored, ...rest } = input
  const values = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)) as Record<string, string>
  const original = await readFile(join(dir, PATHS.wbs), 'utf8')
  return writeChecked(dir, PATHS.wbs, upsertRow(original, 'id', id, values), original, `WBS の ${id} を${create ? '足した' : '直した'}`)
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
  readonly owner?: string
  readonly label?: string
}

const RULE_HEADER = 'id\tphase\tkind\tfrom\tto\tfield\tonly\towner\tlabel\n'

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
  const id = checkId(input.id, 'ルール')
  const project = await loadProject(dir)
  const exists = project.rules.some(r => r.id === id)
  if (create && exists) throw new WriteRefused([`ルール ${id} はもうあります`])
  if (!create && !exists) throw new WriteRefused([`ルール ${id} はありません`])
  if (input.phase !== undefined && !project.phases.some(p => p.id === input.phase)) throw new WriteRefused([`工程「${input.phase}」は設定にありません`])
  if (create && (!input.phase || !input.kind || !input.label)) throw new WriteRefused(['足すルールには phase・kind・label が要ります'])

  const path = create ? `${RULESETS}/${DEFAULT_RULESET}` : ((await rulesetOf(dir, id)) as string)
  const original = await readOr(join(dir, path), RULE_HEADER)
  const { id: _ignored, ...rest } = input
  const values = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)) as Record<string, string>
  return writeChecked(dir, path, upsertRow(original, 'id', id, values), original, `ルール ${id} を${create ? '足した' : '直した'}`)
}

export async function removeRule(dir: string, rawId: string): Promise<CommitResult> {
  const id = checkId(rawId, 'ルール')
  const path = await rulesetOf(dir, id)
  if (!path) throw new WriteRefused([`ルール ${id} はありません`])
  const original = await readFile(join(dir, path), 'utf8')
  return writeChecked(dir, path, removeRow(original, 'id', id) as string, original, `ルール ${id} を消した`)
}

// ---- 人の表 ----

export interface MemberInput {
  readonly name: string
  readonly git?: string
  readonly roles?: readonly string[]
}

/** 人の表（.tadori/members.tsv）に足すか直す。表が無ければ作る */
export async function saveMember(dir: string, input: MemberInput): Promise<CommitResult> {
  const name = checkId(input.name, '人')
  const original = await readOr(join(dir, MEMBERS), 'name\tgit\troles\n')
  const values: Record<string, string> = {
    ...(input.git !== undefined ? { git: input.git } : {}),
    ...(input.roles !== undefined ? { roles: input.roles.flatMap(r => ownersOf(r)).join('・') } : {}),
  }
  return writeChecked(dir, MEMBERS, upsertRow(original, 'name', name, values), null, `人の表の ${name} を直した`)
}

export async function removeMember(dir: string, rawName: string): Promise<CommitResult> {
  const name = checkId(rawName, '人')
  const original = await readOr(join(dir, MEMBERS), '')
  const next = original ? removeRow(original, 'name', name) : null
  if (next === null) throw new WriteRefused([`人の表に ${name} はありません`])
  return writeChecked(dir, MEMBERS, next, original, `人の表から ${name} を消した`)
}
