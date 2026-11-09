import {
  buildDaily, DAILY_SECTIONS, entriesFromSheet, loadProject, mergeDaily, ownersOf, readActivity, readDaily, readDailyFormat, readMembers,
  readStatusChanges, writeDaily, type CommitResult, type DailyEntry, type DailySection,
} from '@tadori/core'
import { dailyFormatOf, formatEntries, type DailyFormat } from './daily-format.js'
import { localToday } from './state.js'

/**
 * 人単位の「1 日の進行」。画面・CLI・MCP が同じものを使う。
 * 材料（WBS の状態の変化・台帳の差分・チェックの記録）から下書きを作り、日ごとのファイル（.tadori/daily/）に置く。
 * 人とエージェントは行を足す・直す・消す。直した行は、作り直しても上書きしない。
 */

export interface Daily {
  readonly date: string
  /** 文（見出し 4 つ・本文・補足。形は案件の .tadori/daily-format.tsv で決める） */
  readonly text: string
  /** 担当の選択肢 */
  readonly owners: readonly string[]
  /** 行（消した印の行は除く）。エージェントが直すときに ID を使う */
  readonly entries: readonly DailyEntry[]
  /** 日ごとのファイルに置いてあるか（まだなら、いまの材料から作った下書きを見せている） */
  readonly saved: boolean
  /** 画面の頭に出す説明（案件の daily-format.tsv の intro。空なら画面の既定の説明） */
  readonly intro: string
}

export class DailyInputError extends Error {
  constructor(message: string, readonly status: 400 | 404 = 400) {
    super(message)
  }
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
/** 日付の形が正しいか（画面・CLI・MCP の入口で確かめる） */
export const isDay = (value: string): boolean => DATE_PATTERN.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))

const MAX_TEXT = 500

/** 案件の文の形（.tadori/daily-format.tsv。書かなければ既定の形） */
const formatOf = async (dir: string): Promise<DailyFormat> => dailyFormatOf(await readDailyFormat(dir))

/** いまの材料から作った、自動の行 */
async function freshEntries(dir: string, date: string): Promise<DailyEntry[]> {
  const project = await loadProject(dir)
  const today = localToday()
  const [changes, members, format] = await Promise.all([readStatusChanges(dir, today), readMembers(dir), formatOf(dir)])
  return [...entriesFromSheet(buildDaily(project, changes, date), format.continued), ...(await readActivity(dir, date, today, members, { groupAfter: Number(format.group_after) || 3, kindLabels: project.labels?.kinds ?? {}, workKinds: project.labels?.workKinds ?? [] }))]
}

/** 置いてある行と、いまの材料を合わせた行（保存はしない） */
async function mergedEntries(dir: string, date: string): Promise<{ entries: DailyEntry[]; saved: boolean }> {
  const existing = await readDaily(dir, date)
  return { entries: mergeDaily(existing, await freshEntries(dir, date)), saved: existing.length > 0 }
}

const visible = (e: DailyEntry) => e.origin !== 'removed'
const mine = (who?: string) => (e: DailyEntry) => !who || ownersOf(e.who).includes(who)

export async function loadDaily(dir: string, date: string, who?: string): Promise<Daily> {
  const project = await loadProject(dir)
  const { entries, saved } = await mergedEntries(dir, date)
  const shown = entries.filter(visible).filter(mine(who))
  // 担当の選択肢は、WBS の担当と、行の担当（commit やチェックの記録から来た人）の両方から
  const owners = [...new Set([...project.tasks.flatMap(t => ownersOf(t.owner)), ...entries.flatMap(e => ownersOf(e.who))])]
  const format = await formatOf(dir)
  return { date, text: formatEntries(shown, project, date, format), owners, entries: shown, saved, intro: format.intro }
}

/** 下書きを作って（作り直して）置く。直した行・足した行・消した行は残る */
export async function generateDaily(dir: string, date: string): Promise<CommitResult> {
  const { entries } = await mergedEntries(dir, date)
  return writeDaily(dir, date, entries, `1 日の進行の下書きを作った（${date}）`)
}

function text(body: Record<string, unknown>, key: string, required: boolean): string | undefined {
  const value = body[key]
  if (value === undefined || value === null || value === '') {
    if (required) throw new DailyInputError(`${key} を書いてください`)
    return undefined
  }
  if (typeof value !== 'string') throw new DailyInputError(`${key} は文字で渡してください`)
  if (value.length > MAX_TEXT) throw new DailyInputError(`${key} が長すぎます（${MAX_TEXT} 文字まで）`)
  return value.replace(/[\t\r\n]+/g, ' ').trim()
}

function section(body: Record<string, unknown>, required: boolean): DailySection | undefined {
  const value = text(body, 'section', required)
  if (value === undefined) return undefined
  if (!DAILY_SECTIONS.includes(value as DailySection)) throw new DailyInputError(`section は ${DAILY_SECTIONS.join(' / ')} のどれかにしてください`)
  return value as DailySection
}

const wbsList = (body: Record<string, unknown>): string[] | undefined => {
  const value = body.wbs
  if (value === undefined) return undefined
  const list = Array.isArray(value) ? value : String(value).split(/[、,]/)
  return list.map(v => String(v).trim()).filter(Boolean)
}

const asBody = (body: unknown): Record<string, unknown> => {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new DailyInputError('JSON のオブジェクトで渡してください')
  return body as Record<string, unknown>
}

/** 行を足す（人かエージェントが書いた行。作り直しても残る） */
export async function addDaily(dir: string, date: string, input: unknown): Promise<{ entry: DailyEntry; commit: CommitResult }> {
  const body = asBody(input)
  const { entries } = await mergedEntries(dir, date)
  const used = new Set(entries.map(e => e.id))
  let n = 1
  while (used.has(`m${n}`)) n += 1
  const issue = text(body, 'issue', false)
  const note = text(body, 'note', false)
  const entry: DailyEntry = {
    id: `m${n}`,
    who: text(body, 'who', false) ?? '',
    section: section(body, true) as DailySection,
    text: text(body, 'text', true) as string,
    wbs: wbsList(body) ?? [],
    ...(issue ? { issue } : {}),
    ...(note ? { note } : {}),
    origin: 'manual',
  }
  const commit = await writeDaily(dir, date, [...entries, entry], `1 日の進行に行を足した（${date}）`)
  return { entry, commit }
}

/** 行を直す。自動の行は「直した」になり、作り直しても上書きされない */
export async function updateDaily(dir: string, date: string, id: string, input: unknown): Promise<{ entry: DailyEntry; commit: CommitResult }> {
  const body = asBody(input)
  const { entries } = await mergedEntries(dir, date)
  const current = entries.find(e => e.id === id && visible(e))
  if (!current) throw new DailyInputError(`${date} に行 ${id} はありません`, 404)
  const patch = {
    who: text(body, 'who', false),
    section: section(body, false),
    text: text(body, 'text', false),
    wbs: wbsList(body),
    issue: text(body, 'issue', false),
    note: text(body, 'note', false),
  }
  const changed = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined))
  const entry: DailyEntry = { ...current, ...changed, origin: current.origin === 'manual' ? 'manual' : 'edited' }
  const commit = await writeDaily(dir, date, entries.map(e => (e.id === id ? entry : e)), `1 日の進行の行 ${id} を直した（${date}）`)
  return { entry, commit }
}

/** 行を消す。自動の行は「消した」印を残し、作り直しても戻ってこないようにする。足した行はそのまま消す */
export async function removeDaily(dir: string, date: string, id: string): Promise<{ commit: CommitResult }> {
  const { entries } = await mergedEntries(dir, date)
  const current = entries.find(e => e.id === id && visible(e))
  if (!current) throw new DailyInputError(`${date} に行 ${id} はありません`, 404)
  const next = current.origin === 'manual'
    ? entries.filter(e => e.id !== id)
    : entries.map(e => (e.id === id ? { ...e, origin: 'removed' as const } : e))
  return { commit: await writeDaily(dir, date, next, `1 日の進行の行 ${id} を消した（${date}）`) }
}
