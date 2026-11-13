import { readFile, readdir, stat } from 'node:fs/promises'
import { isAbsolute, join, normalize } from 'node:path'
import { RULE_GROUP_COLORS, RULE_GROUP_SCOPES, type Approval, type ApprovalStatus, type Item, type Phase, type Project, type Rule, type RuleGroup, type RuleGroupColor, type RuleGroupScope, type RuleKind, type StatusDef, type Task } from '../domain/model.js'
import { checkpointsOf } from '../usecase/checkpoint.js'
import { validateLinkTemplate, type LinkTemplate } from '../domain/links.js'
import type { SourceDef } from '../domain/sources.js'
import { t } from '../i18n.js'
import { parseTestSheet, type TestSheetRow } from './test-sheet.js'
import { parseTsv } from './tsv.js'

/**
 * 案件のフォルダの置き方（すべて git で管理する TSV）
 *
 *   .tadori/project.tsv          案件の名前
 *   .tadori/phases.tsv           工程の並び（案件ごとに違う）
 *   .tadori/statuses.tsv         WBS のステータスの設定
 *   .tadori/rulesets/*.tsv       工程ごとのルールセット
 *   .tadori/checks.tsv           チェックの記録（5W1H）
 *   .tadori/checkpoints.tsv      節目の並び（無くてもよい。無ければ既定の 4 つ）
 *   .tadori/checkpoint-log.tsv   節目で確かめた記録（追記だけ）
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
  sheets: '.tadori/sheets.tsv',
  ruleGroups: '.tadori/rule-groups.tsv',
  checkpoints: '.tadori/checkpoints.tsv',
} as const

/** ルールの at 列に、案件の節目に無い ID が書かれていないか（打ち間違いで黙って効かなくならないように） */
function unknownCheckpointProblems(project: Project): string[] {
  const known = new Set(checkpointsOf(project).map(c => c.id))
  return project.rules.flatMap(rule => (rule.at ?? []).filter(id => !known.has(id)).map(id =>
    t('Rule {id}: the checkpoint "{at}" is not defined ({allowed})', { id: rule.id, at: id, allowed: [...known].join(' / ') })))
}

/** 読み込みで見つかった問題をまとめて返す（1 つずつ直させない） */
export class ProjectLoadError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(t('Could not read the project:\n- {problems}', { problems: problems.join('\n- ') }))
    this.name = 'ProjectLoadError'
  }
}

const RULE_KINDS: readonly RuleKind[] = ['covered', 'refers', 'filled', 'allowed', 'approval', 'note']
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

/** 案件のフォルダの外を指していないか（../ や絶対パスは読まない） */
const isInsideProject = (path: string) => !isAbsolute(path) && !normalize(path).startsWith('..')

/**
 * md-business の検証シートの行を、台帳の行として読む（.tadori/sheets.tsv に書いたシートだけ）。
 * WBS と同じく、台帳へ書き写さない（正本を 2 つにしない）。tadori はシートに書き戻さない。
 * sheets.tsv の列：path（案件の中の場所）・kind（台帳の種類）・id／title／refs（それぞれに使うシートの列名）
 */
async function loadSheetItems(dir: string, rows: readonly Record<string, string>[], problems: string[]): Promise<Item[]> {
  const items: Item[] = []
  for (const row of rows) {
    const path = (row.path ?? '').trim()
    const kind = (row.kind ?? '').trim()
    if (!path) continue
    if (!isInsideProject(path)) { problems.push(t('{file}, {path}: the sheet must be inside the project folder', { file: PATHS.sheets, path })); continue }
    if (!kind) { problems.push(t('{file}, {path}: write the ledger kind for its rows in the kind column', { file: PATHS.sheets, path })); continue }
    if (!(await exists(join(dir, path)))) { problems.push(t('{file}: {path} is missing', { file: PATHS.sheets, path })); continue }
    const sheet = parseTestSheet(await readFile(join(dir, path), 'utf8'))
    if (!sheet) { problems.push(t('{file}: {path} is not an md-business verification sheet (its first line must be "#! md-business:test-spec-tsv/v1")', { file: PATHS.sheets, path })); continue }
    items.push(...sheetRowsToItems(sheet.rows, { path, kind, id: (row.id ?? '').trim(), title: (row.title ?? '').trim(), refs: (row.refs ?? '').trim() }, problems))
  }
  return items
}

interface SheetColumns { readonly path: string; readonly kind: string; readonly id: string; readonly title: string; readonly refs: string }

function sheetRowsToItems(rows: readonly TestSheetRow[], columns: SheetColumns, problems: string[]): Item[] {
  const used = new Set([columns.id, columns.title, columns.refs].filter(Boolean))
  return rows.flatMap(r => {
    // ID の列が空の行は、md-business の行 ID で指す（まだ ID を振っていない行も落とさず、漏れとして見せる）
    const id = (columns.id ? (r.cells[columns.id] ?? '').trim() : '') || r.rowId || ''
    if (!id) {
      problems.push(t('{path}, line {line}: the row has no ID (fill the "{column}" column, or open the sheet in md-business once so it gives the row an ID)', { path: columns.path, line: r.line, column: columns.id || '_id' }))
      return []
    }
    return [{
      id,
      kind: columns.kind,
      title: columns.title ? (r.cells[columns.title] ?? '').trim() : '',
      source: columns.path,
      refs: columns.refs ? splitRefs(r.cells[columns.refs] ?? '') : [],
      fields: Object.fromEntries(Object.entries(r.cells).filter(([name]) => !used.has(name))),
      file: columns.path,
      line: r.line,
      ...(r.rowId ? { rowId: r.rowId } : {}),
    }]
  })
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
        problems.push(t('{file}, rule {id}: the check kind "{kind}" is not allowed ({allowed}). If this project was written with a newer tadori, update tadori and reconnect it (for MCP, run /mcp)', { file: `${PATHS.rulesets}/${file}`, id: String(row.id), kind: String(row.kind), allowed: RULE_KINDS.join(' / ') }))
        return []
      }
      const only = parseOnly(row.only ?? '')
      const owner = (row.owner ?? '').trim()
      const values = splitValues(row.values ?? '')
      const group = (row.group ?? '').trim()
      const phase = (row.phase ?? '').trim()
      const at = splitValues(row.at ?? '')
      const check = (row.check ?? '').trim()
      // 判定するルールは、どの工程のものかが無いと、工程の完了判定に入らず黙って抜ける
      if (kind !== 'note' && !phase) {
        problems.push(t('{file}, rule {id}: write the phase (only "note" rules may leave it empty)', { file: `${PATHS.rulesets}/${file}`, id: String(row.id) }))
        return []
      }
      // allowed は、書いてよい値（values 列）と見る列（field 列）が無いと判定できない
      if (kind === 'allowed' && (!values.length || !(row.field ?? '').trim())) {
        problems.push(t('{file}, rule {id}: an "allowed" rule needs a field and its allowed values in the values column (e.g. OK|NG)', { file: `${PATHS.rulesets}/${file}`, id: String(row.id) }))
        return []
      }
      return [{
        id: row.id ?? '', phase, kind, from: row.from ?? '', to: row.to ?? '', field: row.field ?? '', label: row.label ?? '',
        ...(only ? { only } : {}),
        ...(values.length ? { values } : {}),
        ...(owner ? { owner } : {}),
        ...(group ? { group } : {}),
        ...(at.length ? { at } : {}),
        ...(check ? { check } : {}),
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

/** ルールの分類（id・name・order）。order の小さい順。order が無ければ書いた順のうしろ */
function toRuleGroups(rows: readonly Record<string, string>[], problems: string[]): RuleGroup[] {
  return rows.filter(r => r.id?.trim()).map((r, i) => {
    const id = (r.id as string).trim()
    const order = Number(r.order)
    const color = (r.color ?? '').trim()
    const scope = (r.scope ?? '').trim()
    // 色と範囲は決まった値だけ（打ち間違いを黙って既定に戻さない）
    if (color && !(RULE_GROUP_COLORS as readonly string[]).includes(color)) problems.push(t('{file}, {id}: color "{value}" must be one of {allowed}', { file: PATHS.ruleGroups, id, value: color, allowed: RULE_GROUP_COLORS.join(' / ') }))
    if (scope && !(RULE_GROUP_SCOPES as readonly string[]).includes(scope)) problems.push(t('{file}, {id}: scope "{value}" must be one of {allowed}', { file: PATHS.ruleGroups, id, value: scope, allowed: RULE_GROUP_SCOPES.join(' / ') }))
    return {
      id,
      name: (r.name ?? '').trim() || id,
      order: Number.isFinite(order) && r.order?.trim() ? order : 1000 + i,
      ...((RULE_GROUP_COLORS as readonly string[]).includes(color) ? { color: color as RuleGroupColor } : {}),
      ...((RULE_GROUP_SCOPES as readonly string[]).includes(scope) ? { scope: scope as RuleGroupScope } : {}),
    }
  }).sort((a, b) => a.order - b.order)
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
  const [projectRows, phaseRows, statusRows, rules, itemRows, wbsRows, approvalRows, kindRows, columnRows, linkRows, sourceRows, sheetRows, ruleGroupRows, checkpointRows] = await Promise.all([
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
    readRows(dir, PATHS.sheets),
    readRows(dir, PATHS.ruleGroups),
    readRows(dir, PATHS.checkpoints),
  ])
  const phases: Phase[] = phaseRows.map(row => {
    const order = Number(row.order)
    if (!Number.isFinite(order)) problems.push(t('{file}, {id}: order "{order}" must be a number', { file: PATHS.phases, id: String(row.id), order: String(row.order) }))
    return { id: row.id ?? '', name: row.name ?? '', order }
  })
  const statuses = toStatuses(statusRows, problems)
  // WBS の状態は ID で書く約束だが、名前（例「完了」）で書かれていたら、その ID として読む（名前で書いても同じ扱いにする）
  const idByName = new Map(statuses.map(s => [s.name, s.id]))
  const knownIds = new Set(statuses.map(s => s.id))
  const tasks = wbsRows.map(row => toTask(row, problems)).map(task => (!knownIds.has(task.status) && idByName.has(task.status) ? { ...task, status: idByName.get(task.status) as string } : task))
  // WBS のタスクは台帳の行（種類 W）としても辿れるようにする。台帳へ書き写すと正本が 2 つになるため
  const taskItems: Item[] = tasks.map(t => ({ id: t.id, kind: 'W', title: t.name, source: PATHS.wbs, refs: [], fields: {}, file: PATHS.wbs, ...(t.line ? { line: t.line } : {}) }))
  const items = [...taskItems, ...itemRows.map(toItem), ...(await loadSheetItems(dir, sheetRows, problems))]
  problems.push(...duplicateIdProblems(items))
  const project: Project = {
    name: projectRows.at(0)?.name ?? '',
    ...(projectRows.at(0)?.schedule_label?.trim() ? { scheduleLabel: (projectRows.at(0)?.schedule_label as string).trim() } : {}),
    phases,
    rules,
    items,
    tasks,
    approvals: toApprovals(approvalRows, problems),
    statuses,
    labels: {
      kinds: toNameMap(kindRows),
      columns: toNameMap(columnRows),
      // work 列に印（yes・○・1・true など）がある種類は「やったこと」（1 日の進行で、台帳の整備と分ける）
      workKinds: kindRows.filter(r => r.id && /^(yes|y|true|1|○|◯)$/i.test((r.work ?? '').trim())).map(r => r.id as string),
    },
    links: toLinks(linkRows, problems),
    sources: toSources(sourceRows, problems),
    ruleGroups: toRuleGroups(ruleGroupRows, problems),
    ...(checkpointRows.length ? { checkpoints: checkpointRows.map(r => ({ id: (r.id ?? '').trim(), name: (r.name ?? '').trim() || (r.id ?? '').trim(), ...((r.nudge ?? '').trim() === 'block' ? { nudge: 'block' as const } : {}) })) } : {}),
  }
  problems.push(...unknownCheckpointProblems(project))
  if (problems.length) throw new ProjectLoadError(problems)
  return project
}
