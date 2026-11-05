import { readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { Approval, ApprovalStatus, Item, Phase, Project, Rule, RuleKind, StatusDef, Task } from '../domain/model.js'
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
} as const

/** 読み込みで見つかった問題をまとめて返す（1 つずつ直させない） */
export class ProjectLoadError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`案件を読めませんでした：\n- ${problems.join('\n- ')}`)
    this.name = 'ProjectLoadError'
  }
}

const RULE_KINDS: readonly RuleKind[] = ['covered', 'refers', 'filled', 'approval']
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

/** 無くてもよいファイル（承認の記録など）を読む。無ければ空 */
async function readRows(dir: string, path: string): Promise<readonly Record<string, string>[]> {
  const full = join(dir, path)
  if (!(await exists(full))) return []
  return parseTsv(await readFile(full, 'utf8')).rows
}

/**
 * 無いと困るファイルを読む。無ければ問題として記録する
 * （無いまま空として扱うと、漏れが 0 件に見えて「通過」と出てしまうため）
 */
async function readRequiredRows(dir: string, path: string, problems: string[]): Promise<readonly Record<string, string>[]> {
  if (!(await exists(join(dir, path)))) {
    problems.push(`${path} がありません`)
    return []
  }
  return readRows(dir, path)
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const isValidDate = (value: string): boolean => DATE_PATTERN.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))

const splitRefs = (value: string): string[] =>
  value.split(/[、,]/).map(s => s.trim()).filter(Boolean)

function toItem(row: Record<string, string>): Item {
  const fields = Object.fromEntries(Object.entries(row).filter(([k]) => !ITEM_BASE_COLUMNS.has(k)))
  return {
    id: row.id ?? '',
    kind: row.kind ?? '',
    title: row.title ?? '',
    source: row.source ?? '',
    refs: splitRefs(row.refs ?? ''),
    fields,
  }
}

function toTask(row: Record<string, string>, problems: string[]): Task {
  const start = row.start ?? ''
  const end = row.end ?? ''
  // 日付は画面に埋め込まれ、遅れの計算にも使うので形を確かめる
  for (const [label, value] of [['start', start], ['end', end]] as const) {
    if (value && !isValidDate(value)) problems.push(`${PATHS.wbs} の ${row.id}：${label} の日付「${value}」は YYYY-MM-DD で書いてください`)
  }
  return {
    id: row.id ?? '',
    phase: row.phase ?? '',
    name: row.name ?? '',
    status: row.status ?? '',
    ...(start && end ? { start, end } : {}),
  }
}

/** only 列「列名=値」を読む。空なら絞らない */
function parseOnly(value: string): Rule['only'] | undefined {
  const at = value.indexOf('=')
  if (at <= 0) return undefined
  return { field: value.slice(0, at).trim(), value: value.slice(at + 1).trim() }
}

async function loadRules(dir: string, problems: string[]): Promise<Rule[]> {
  const folder = join(dir, PATHS.rulesets)
  if (!(await exists(folder))) {
    problems.push(`${PATHS.rulesets} がありません（ルールが無いと、漏れが 0 件に見えてしまいます）`)
    return []
  }
  const files = (await readdir(folder)).filter(f => f.endsWith('.tsv')).sort()
  const perFile = await Promise.all(files.map(async file => {
    const rows = await readRows(dir, `${PATHS.rulesets}/${file}`)
    return rows.flatMap(row => {
      const kind = row.kind as RuleKind
      if (!RULE_KINDS.includes(kind)) {
        problems.push(`${PATHS.rulesets}/${file} のルール ${row.id}：判定の種類「${row.kind}」は使えません（${RULE_KINDS.join(' / ')}）`)
        return []
      }
      const only = parseOnly(row.only ?? '')
      return [{
        id: row.id ?? '', phase: row.phase ?? '', kind, from: row.from ?? '', to: row.to ?? '', field: row.field ?? '', label: row.label ?? '',
        ...(only ? { only } : {}),
      }]
    })
  }))
  return perFile.flat()
}

function toApprovals(rows: readonly Record<string, string>[], problems: string[]): Approval[] {
  return rows.flatMap(row => {
    const status = row.status as ApprovalStatus
    if (!APPROVAL_STATUSES.includes(status)) {
      problems.push(`${PATHS.approvals} のルール ${row.rule}：状態「${row.status}」は使えません（${APPROVAL_STATUSES.join(' / ')}）`)
      return []
    }
    return [{ rule: row.rule ?? '', status, who: row.who ?? '', when: row.when ?? '' }]
  })
}

function toStatuses(rows: readonly Record<string, string>[], problems: string[]): StatusDef[] {
  return rows.flatMap(row => {
    const tone = row.tone as StatusDef['tone']
    if (!TONES.includes(tone)) {
      problems.push(`${PATHS.statuses} の ${row.id}：色の意味「${row.tone}」は使えません（${TONES.join(' / ')}）`)
      return []
    }
    return [{ id: row.id ?? '', name: row.name ?? '', tone }]
  })
}

/** 同じ ID の行が 2 つあると、辿るときにどちらか一方が黙って消えるので止める */
function duplicateIdProblems(items: readonly Item[]): string[] {
  const seen = new Set<string>()
  const duplicated = new Set<string>()
  for (const item of items) {
    if (seen.has(item.id)) duplicated.add(item.id)
    seen.add(item.id)
  }
  return [...duplicated].map(id => `ID「${id}」が重複しています（${PATHS.wbs} と ${PATHS.items} の間の重複も含む）`)
}

/** 案件のフォルダを読む。問題があれば、全部まとめて ProjectLoadError で返す */
export async function loadProject(dir: string): Promise<Project> {
  if (!(await exists(join(dir, '.tadori')))) {
    throw new ProjectLoadError([`${dir} に .tadori フォルダがありません。tadori の案件のフォルダを指定してください`])
  }
  const problems: string[] = []
  const [projectRows, phaseRows, statusRows, rules, itemRows, wbsRows, approvalRows] = await Promise.all([
    readRows(dir, PATHS.project),
    readRequiredRows(dir, PATHS.phases, problems),
    readRequiredRows(dir, PATHS.statuses, problems),
    loadRules(dir, problems),
    readRequiredRows(dir, PATHS.items, problems),
    readRows(dir, PATHS.wbs),
    readRows(dir, PATHS.approvals),
  ])
  const phases: Phase[] = phaseRows.map(row => {
    const order = Number(row.order)
    if (!Number.isFinite(order)) problems.push(`${PATHS.phases} の ${row.id}：order「${row.order}」は数で書いてください`)
    return { id: row.id ?? '', name: row.name ?? '', order }
  })
  const tasks = wbsRows.map(row => toTask(row, problems))
  // WBS のタスクは台帳の行（種類 W）としても辿れるようにする。台帳へ書き写すと正本が 2 つになるため
  const taskItems: Item[] = tasks.map(t => ({ id: t.id, kind: 'W', title: t.name, source: PATHS.wbs, refs: [], fields: {} }))
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
  }
  if (problems.length) throw new ProjectLoadError(problems)
  return project
}
