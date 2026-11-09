import { readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { Approval, ApprovalStatus, Item, Phase, Project, Rule, RuleKind, StatusDef, Task } from '../domain/model.js'
import { validateLinkTemplate, type LinkTemplate } from '../domain/links.js'
import type { SourceDef } from '../domain/sources.js'
import { t } from '../i18n.js'
import { parseTsv } from './tsv.js'

/**
 * 案件のフォルダの置き方（すべて git で管理する TSV）
 *
 *   .tadori/project.tsv          案件の名前
 *   .tadori/phases.tsv           工程の並び（案件ごとに違う）
 *   .tadori/statuses.tsv         WBS のステータスの設定
 *   .tadori/rulesets/*.tsv       工程ごとのルールセット
 *   .tadori/checks.tsv           チェックの記録（5W1H）
 *   ledger/items.tsv             台帳（設計書の章・節、commit、観点、試験ケース、試験の記録、指摘…）
 *   ledger/wbs.tsv               WBS のタスク
 *   ledger/approvals.tsv         人の承認の記録（人が書く）
 *   .tadori/kinds.tsv            種類の読み方（無くてもよい）
 *   .tadori/columns.tsv          列の読み方（無くてもよい）
 */
export const PATHS = {
  project: '.tadori/project.tsv',
  phases: '.tadori/phases.tsv',
  statuses: '.tadori/statuses.tsv',
  rulesets: '.tadori/rulesets',
  checks: '.tadori/checks.tsv',
  items: 'ledger/items.tsv',
  wbs: 'ledger/wbs.tsv',
  approvals: 'ledger/approvals.tsv',
  kinds: '.tadori/kinds.tsv',
  links: '.tadori/links.tsv',
  sources: '.tadori/sources.tsv',
  columns: '.tadori/columns.tsv',
} as const

/** 読み込みで見つかった問題をまとめて返す（1 つずつ直させない） */
export class ProjectLoadError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(t('Could not read the project:\n- {problems}', { problems: problems.join('\n- ') }))
    this.name = 'ProjectLoadError'
  }
}

const RULE_KINDS: readonly RuleKind[] = ['covered', 'refers', 'filled', 'allowed', 'approval']
const APPROVAL_STATUSES: readonly ApprovalStatus[] = ['承認', '差し戻し', '待ち']
const TONES: readonly StatusDef['tone'][] = ['none', 'wait', 'hole', 'ok']
const ITEM_BASE_COLUMNS = new Set(['id', 'kind', 'title', 'source', 'refs'])

const isNotFound = (error: unknown): boolean => (error as NodeJS.ErrnoException)?.code === 'ENOENT'

/** 無いときだけ false。読めない（権限など）ときは、無いことにせず投げる */
async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error: unknown) {
    if (isNotFound(error)) return false
    throw error
  }
}

/** 行と、その行がファイルの何行目か */
interface NumberedRow {
  readonly row: Record<string, string>
  readonly line: number
}

/** 無くてもよいファイルを、行番号つきで読む。無ければ空 */
async function readNumberedRows(dir: string, path: string): Promise<readonly NumberedRow[]> {
  const full = join(dir, path)
  if (!(await exists(full))) return []
  const tsv = parseTsv(await readFile(full, 'utf8'))
  return tsv.rows.map((row, i) => ({ row, line: tsv.lineNumbers[i] ?? 0 }))
}

/** 無くてもよいファイル（承認の記録など）を読む。無ければ空 */
async function readRows(dir: string, path: string): Promise<readonly Record<string, string>[]> {
  return (await readNumberedRows(dir, path)).map(r => r.row)
}

/**
 * 無いと困るファイルを、行番号つきで読む。無ければ問題として記録する
 * （無いまま空として扱うと、漏れが 0 件に見えて「通過」と出てしまうため）
 */
async function readRequiredNumberedRows(dir: string, path: string, problems: string[]): Promise<readonly NumberedRow[]> {
  if (!(await exists(join(dir, path)))) {
    problems.push(t('{path} is missing', { path }))
    return []
  }
  return readNumberedRows(dir, path)
}

async function readRequiredRows(dir: string, path: string, problems: string[]): Promise<readonly Record<string, string>[]> {
  return (await readRequiredNumberedRows(dir, path, problems)).map(r => r.row)
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const isValidDate = (value: string): boolean => DATE_PATTERN.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))

const splitRefs = (value: string): string[] =>
  value.split(/[、,]/).map(s => s.trim()).filter(Boolean)

function toItem({ row, line }: NumberedRow): Item {
  const fields = Object.fromEntries(Object.entries(row).filter(([k]) => !ITEM_BASE_COLUMNS.has(k)))
  return {
    id: row.id ?? '',
    kind: row.kind ?? '',
    title: row.title ?? '',
    source: row.source ?? '',
    refs: splitRefs(row.refs ?? ''),
    fields,
    file: PATHS.items,
    line,
  }
}

function toTask({ row, line }: NumberedRow, problems: string[]): Task {
  const start = row.start ?? ''
  const end = row.end ?? ''
  // 日付は画面に埋め込まれ、遅れの計算にも使うので形を確かめる
  for (const [label, value] of [['start', start], ['end', end]] as const) {
    if (value && !isValidDate(value)) problems.push(t('{file}, {id}: the {label} date "{value}" must be written as YYYY-MM-DD', { file: PATHS.wbs, id: String(row.id), label, value }))
  }
  return {
    id: row.id ?? '',
    phase: row.phase ?? '',
    name: row.name ?? '',
    status: row.status ?? '',
    ...(start && end ? { start, end } : {}),
    ...(row.owner?.trim() ? { owner: row.owner.trim() } : {}),
    ...(row.issue?.trim() ? { issue: row.issue.trim() } : {}),
    line,
  }
}

/** 「a|b」を値の並びにする（前後の空白を外し、空は捨てる） */
const splitValues = (text: string) => text.split('|').map(v => v.trim()).filter(Boolean)

/** only 列「列名=値」「列名=値1|値2」「列名!=値」を読む。空なら絞らない */
function parseOnly(text: string): Rule['only'] | undefined {
  const at = text.indexOf('=')
  if (at <= 0) return undefined
  const negate = text[at - 1] === '!'
  const field = text.slice(0, negate ? at - 1 : at).trim()
  const value = text.slice(at + 1).trim()
  if (!field) return undefined
  return { field, value, values: splitValues(value), negate }
}

async function loadRules(dir: string, problems: string[]): Promise<Rule[]> {
  const folder = join(dir, PATHS.rulesets)
  if (!(await exists(folder))) {
    problems.push(t('{path} is missing (without rules, there would appear to be 0 gaps)', { path: PATHS.rulesets }))
    return []
  }
  const files = (await readdir(folder)).filter(f => f.endsWith('.tsv')).sort()
  const perFile = await Promise.all(files.map(async file => {
    const rows = await readRows(dir, `${PATHS.rulesets}/${file}`)
    return rows.flatMap(row => {
      const kind = row.kind as RuleKind
      if (!RULE_KINDS.includes(kind)) {
        problems.push(t('{file}, rule {id}: the check kind "{kind}" is not allowed ({allowed})', { file: `${PATHS.rulesets}/${file}`, id: String(row.id), kind: String(row.kind), allowed: RULE_KINDS.join(' / ') }))
        return []
      }
      const only = parseOnly(row.only ?? '')
      const owner = (row.owner ?? '').trim()
      const values = splitValues(row.values ?? '')
      // allowed は、書いてよい値（values 列）と見る列（field 列）が無いと判定できない
      if (kind === 'allowed' && (!values.length || !(row.field ?? '').trim())) {
        problems.push(t('{file}, rule {id}: an "allowed" rule needs a field and its allowed values in the values column (e.g. OK|NG)', { file: `${PATHS.rulesets}/${file}`, id: String(row.id) }))
        return []
      }
      return [{
        id: row.id ?? '', phase: row.phase ?? '', kind, from: row.from ?? '', to: row.to ?? '', field: row.field ?? '', label: row.label ?? '',
        ...(only ? { only } : {}),
        ...(values.length ? { values } : {}),
        ...(owner ? { owner } : {}),
      }]
    })
  }))
  return perFile.flat()
}

/** approvals.tsv の status に英語でも書ける値（大文字・小文字は問わない）。中では日本語の値と同じに扱う */
const APPROVAL_STATUS_ALIASES: Readonly<Record<string, ApprovalStatus>> = {
  'approved': '承認', 'sent back': '差し戻し', 'rejected': '差し戻し', 'pending': '待ち', 'waiting': '待ち',
}
const approvalStatusOf = (value: string | undefined): ApprovalStatus | undefined => {
  const text = (value ?? '').trim()
  if (APPROVAL_STATUSES.includes(text as ApprovalStatus)) return text as ApprovalStatus
  return APPROVAL_STATUS_ALIASES[text.toLowerCase()]
}

function toApprovals(rows: readonly Record<string, string>[], problems: string[]): Approval[] {
  return rows.flatMap(row => {
    const status = approvalStatusOf(row.status)
    if (!status) {
      // 状態の値は人が approvals.tsv に書くデータ。日本語（承認・差し戻し・待ち）か英語（approved・sent back・pending）で書く
      problems.push(t('{file}, rule {rule}: the status "{status}" is not allowed ({allowed})', { file: PATHS.approvals, rule: String(row.rule), status: String(row.status), allowed: `${APPROVAL_STATUSES.join(' / ')} / approved / sent back / pending` }))
      return []
    }
    return [{ rule: row.rule ?? '', status, who: row.who ?? '', when: row.when ?? '' }]
  })
}

function toStatuses(rows: readonly Record<string, string>[], problems: string[]): StatusDef[] {
  return rows.flatMap(row => {
    const tone = row.tone as StatusDef['tone']
    if (!TONES.includes(tone)) {
      problems.push(t('{file}, {id}: the tone "{tone}" is not allowed ({allowed})', { file: PATHS.statuses, id: String(row.id), tone: String(row.tone), allowed: TONES.join(' / ') }))
      return []
    }
    return [{ id: row.id ?? '', name: row.name ?? '', tone }]
  })
}

/** ほかの道具を開くリンクの雛形を読む。使えない形（javascript: など）は問題として止める */
/** 正本の表の既定の日数（これを超えて反映していない行を「古い」として目立たせる） */
const DEFAULT_STALE_DAYS = 14

/** 正本の表（name・url・locator・stale_days）。URL とひな形は、押すと命令が動く形を止める */
function toSources(rows: readonly Record<string, string>[], problems: string[]): SourceDef[] {
  return rows.filter(r => r.name && r.url).flatMap(r => {
    const name = r.name as string
    const url = r.url as string
    const locator = (r.locator ?? '').trim()
    const problem = validateLinkTemplate(url) ?? (locator ? validateLinkTemplate(locator.replace('{url}', url)) : null)
    if (problem) { problems.push(t('{file}, {name}: {problem}', { file: PATHS.sources, name, problem })); return [] }
    const days = Number(r.stale_days)
    return [{ name, url, locator, staleDays: Number.isFinite(days) && days > 0 ? days : DEFAULT_STALE_DAYS }]
  })
}

function toLinks(rows: readonly Record<string, string>[], problems: string[]): LinkTemplate[] {
  return rows.flatMap(row => {
    const tool = (row.tool ?? '').trim()
    const url = (row.url ?? '').trim()
    if (!tool || !url) return []
    const problem = validateLinkTemplate(url)
    if (problem) { problems.push(t('{file}, {name}: {problem}', { file: PATHS.links, name: tool, problem })); return [] }
    return [{ tool, url }]
  })
}

/** id と name の 2 列から、読み方の表を作る */
const toNameMap = (rows: readonly Record<string, string>[]): Record<string, string> =>
  Object.fromEntries(rows.filter(r => r.id && r.name).map(r => [r.id as string, r.name as string]))

/** 同じ ID の行が 2 つあると、辿るときにどちらか一方が黙って消えるので止める */
function duplicateIdProblems(items: readonly Item[]): string[] {
  const seen = new Set<string>()
  const duplicated = new Set<string>()
  for (const item of items) {
    if (seen.has(item.id)) duplicated.add(item.id)
    seen.add(item.id)
  }
  return [...duplicated].map(id => t('The ID "{id}" is duplicated (this includes duplicates between {wbs} and {items})', { id, wbs: PATHS.wbs, items: PATHS.items }))
}

/** 案件のフォルダを読む。問題があれば、全部まとめて ProjectLoadError で返す */
export async function loadProject(dir: string): Promise<Project> {
  if (!(await exists(join(dir, '.tadori')))) {
    throw new ProjectLoadError([t('{dir} has no .tadori folder. Specify a tadori project folder', { dir })])
  }
  const problems: string[] = []
  const [projectRows, phaseRows, statusRows, rules, itemRows, wbsRows, approvalRows, kindRows, columnRows, linkRows, sourceRows] = await Promise.all([
    readRows(dir, PATHS.project),
    readRequiredRows(dir, PATHS.phases, problems),
    readRequiredRows(dir, PATHS.statuses, problems),
    loadRules(dir, problems),
    readRequiredNumberedRows(dir, PATHS.items, problems),
    readNumberedRows(dir, PATHS.wbs),
    readRows(dir, PATHS.approvals),
    readRows(dir, PATHS.kinds),
    readRows(dir, PATHS.columns),
    readRows(dir, PATHS.links),
    readRows(dir, PATHS.sources),
  ])
  const phases: Phase[] = phaseRows.map(row => {
    const order = Number(row.order)
    if (!Number.isFinite(order)) problems.push(t('{file}, {id}: order "{order}" must be a number', { file: PATHS.phases, id: String(row.id), order: String(row.order) }))
    return { id: row.id ?? '', name: row.name ?? '', order }
  })
  const tasks = wbsRows.map(row => toTask(row, problems))
  // WBS のタスクは台帳の行（種類 W）としても辿れるようにする。台帳へ書き写すと正本が 2 つになるため
  const taskItems: Item[] = tasks.map(t => ({ id: t.id, kind: 'W', title: t.name, source: PATHS.wbs, refs: [], fields: {}, file: PATHS.wbs, ...(t.line ? { line: t.line } : {}) }))
  const items = [...taskItems, ...itemRows.map(toItem)]
  problems.push(...duplicateIdProblems(items))
  const project: Project = {
    name: projectRows.at(0)?.name ?? '',
    phases,
    rules,
    items,
    tasks,
    approvals: toApprovals(approvalRows, problems),
    statuses: toStatuses(statusRows, problems),
    labels: {
      kinds: toNameMap(kindRows),
      columns: toNameMap(columnRows),
      // work 列に印（yes・○・1・true など）がある種類は「やったこと」（1 日の進行で、台帳の整備と分ける）
      workKinds: kindRows.filter(r => r.id && /^(yes|y|true|1|○|◯)$/i.test((r.work ?? '').trim())).map(r => r.id as string),
    },
    links: toLinks(linkRows, problems),
    sources: toSources(sourceRows, problems),
  }
  if (problems.length) throw new ProjectLoadError(problems)
  return project
}
