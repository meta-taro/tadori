import './i18n.js'
import {
  BADGE_TONES, buildDaily, carriedOver, DAILY_SECTIONS, DAILY_TAGS, entriesFromSheet, loadProject, mergeDaily, ownersOf, previousDailyDate, readActivity, readDaily, readDailyFormat, readMembers,
  readAloud, readStatusChanges, t, withoutSummaries, writeDaily, type BadgeTone, type CommitResult, type DailyBadge, type DailyEntry, type DailyLink, type DailySection,
} from '@tadori/core'
import { dailyFormatOf, formatEntries, tagText, wbsLabel, whoMark, type DailyFormat } from './daily-format.js'
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
  /** 文の中に出る WBS・課題の書き方と、画面での飛び先（画面が文字を押せるリンクにする。文そのものには URL を足さない） */
  readonly links: readonly { readonly text: string; readonly href: string }[]
  /** 文の中の印の書き方（例：［済］）。画面が小さな札の見た目にする */
  readonly tags: readonly string[]
  /** 担当で絞っていないときに、行の頭に付く担当名の書き方（例：設計担当：）。画面が札の見た目にする。絞っているときは空 */
  readonly whoMarks: readonly string[]
}

/** 行がつながる WBS と課題の、文の中の書き方 → 画面の飛び先（WBS はプロダクトのその行、課題はつながりを辿る） */
export function linksOf(entries: readonly DailyEntry[], format: DailyFormat): Daily['links'] {
  const wbs = [...new Set(entries.flatMap(e => e.wbs))].map(id => ({ text: wbsLabel(id, format), href: `#browse-${id}` }))
  const issues = [...new Set(entries.flatMap(e => (e.issue ? [e.issue] : [])))].map(id => ({ text: id, href: `#trace-${id}` }))
  return [...wbs, ...issues]
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

/** 前の作業日の「次の作業日」に人が足した・直した行（今日の予定として出す。前の日のファイルは書き換えない） */
async function carriedFromPreviousDay(dir: string, date: string): Promise<DailyEntry[]> {
  const previous = await previousDailyDate(dir, date)
  return previous ? carriedOver(await readDaily(dir, previous), previous) : []
}

/** いまの材料から作った、自動の行 */
async function freshEntries(dir: string, date: string): Promise<DailyEntry[]> {
  const project = await loadProject(dir)
  const today = localToday()
  const [changes, members, format] = await Promise.all([readStatusChanges(dir, today), readMembers(dir), formatOf(dir)])
  return [...entriesFromSheet(buildDaily(project, changes, date), format.continued), ...(await carriedFromPreviousDay(dir, date)), ...(await readActivity(dir, date, today, members, { groupAfter: Number(format.group_after) || 3, kindLabels: project.labels?.kinds ?? {}, workKinds: project.labels?.workKinds ?? [] }))]
}

/** 置いてある行と、いまの材料を合わせた行（保存はしない） */
async function mergedEntries(dir: string, date: string): Promise<{ entries: DailyEntry[]; saved: boolean }> {
  const existing = await readDaily(dir, date)
  return { entries: mergeDaily(existing, await freshEntries(dir, date)), saved: existing.length > 0 }
}

const visible = (e: DailyEntry) => e.origin !== 'removed'
const mine = (who?: string) => (e: DailyEntry) => !who || ownersOf(e.who).includes(who)

/** read：読み上げの文（課題ごとの要約があれば、その課題の今日の細かい行の代わりに要約を出す）。既定は詳しく（今までどおり） */
export interface DailyView {
  readonly read?: boolean
}

export async function loadDaily(dir: string, date: string, who?: string, view: DailyView = {}): Promise<Daily> {
  const project = await loadProject(dir)
  const { entries, saved } = await mergedEntries(dir, date)
  const shown = entries.filter(visible).filter(mine(who))
  // 担当の選択肢は、WBS の担当と、行の担当（commit やチェックの記録から来た人）の両方から
  const owners = [...new Set([...project.tasks.flatMap(t => ownersOf(t.owner)), ...entries.flatMap(e => ownersOf(e.who))])]
  const format = await formatOf(dir)
  const spoken = view.read ? readAloud(shown) : withoutSummaries(shown)
  return { date, text: formatEntries(spoken, project, date, format, { showWho: !who }), owners, entries: shown, saved, intro: format.intro, links: linksOf(shown, format), tags: DAILY_TAGS.map(tag => tagText(tag, format)).filter(Boolean),
    whoMarks: who ? [] : [...new Set(shown.map(e => whoMark(e.who, format)).filter(Boolean))] }
}

/** 下書きを作って（作り直して）置く。直した行・足した行・消した行は残る */
export async function generateDaily(dir: string, date: string): Promise<CommitResult> {
  const { entries } = await mergedEntries(dir, date)
  return writeDaily(dir, date, entries, t('Draft daily progress ({date})', { date }))
}

function text(body: Record<string, unknown>, key: string, required: boolean): string | undefined {
  const value = body[key]
  if (value === undefined || value === null || value === '') {
    if (required) throw new DailyInputError(t('{key} is required', { key }))
    return undefined
  }
  if (typeof value !== 'string') throw new DailyInputError(t('{key} must be a string', { key }))
  if (value.length > MAX_TEXT) throw new DailyInputError(t('{key} is too long (up to {max} characters)', { key, max: MAX_TEXT }))
  return value.replace(/[\t\r\n]+/g, ' ').trim()
}

function section(body: Record<string, unknown>, required: boolean): DailySection | undefined {
  const value = text(body, 'section', required)
  if (value === undefined) return undefined
  if (!DAILY_SECTIONS.includes(value as DailySection)) throw new DailyInputError(t('section must be one of {list}', { list: DAILY_SECTIONS.join(' / ') }))
  return value as DailySection
}

/** 行の印（done・doing・plan・upkeep・checked。空なら印なし） */
function tag(body: Record<string, unknown>): string | undefined {
  if (body.tag === undefined) return undefined
  const value = typeof body.tag === 'string' ? body.tag.trim() : ''
  if (value && !(DAILY_TAGS as readonly string[]).includes(value)) throw new DailyInputError(t('tag must be one of {list} (empty for no tag)', { list: DAILY_TAGS.join(' / ') }))
  return value
}

const MAX_LINKS = 8
const MAX_LABEL = 40

/**
 * 行のリンク（その作業でさわった正本の場所）。[{ label, url }] で受ける。
 * URL は http・https だけ（押すと画面の中で命令が動く形や、手元のファイルを開く形は受けない）。表示名に「 | 」は使えない（1 セルに並べて書くため）
 */
function linkList(body: Record<string, unknown>): DailyLink[] | undefined {
  const value = body.links
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw new DailyInputError(t('links must be [{ "label": display name, "url": URL }]'))
  if (value.length > MAX_LINKS) throw new DailyInputError(t('links can have up to {max} items', { max: MAX_LINKS }))
  return value.map((raw, i) => {
    const link = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
    const label = typeof link.label === 'string' ? link.label.replace(/[\t\r\n]+/g, ' ').trim() : ''
    const url = typeof link.url === 'string' ? link.url.trim() : ''
    const no = i + 1
    if (!label || label.length > MAX_LABEL || label.includes('|')) throw new DailyInputError(t('links item {no}: the display name must be 1–{max} characters and must not contain "|"', { no, max: MAX_LABEL }))
    let parsed: URL
    try { parsed = new URL(url) } catch { throw new DailyInputError(t('links item {no}: not a valid URL', { no })) }
    if (!['http:', 'https:'].includes(parsed.protocol) || /\s/.test(url)) throw new DailyInputError(t('links item {no}: the URL must be http or https and must not contain spaces', { no }))
    const anchor = typeof link.anchor === 'string' ? link.anchor.replace(/[\t\r\n]+/g, ' ').trim() : ''
    if (anchor.length > MAX_LABEL * 2 || anchor.includes('|') || anchor.includes(' > ')) throw new DailyInputError(t('links item {no}: anchor must be up to {max} characters and must not contain "|" or " > "', { no, max: MAX_LABEL * 2 }))
    const nth = link.nth === undefined ? 1 : Number(link.nth)
    if (!Number.isInteger(nth) || nth < 1 || nth > MAX_NTH) throw new DailyInputError(t('links item {no}: nth must be an integer from 1 to {max}', { no, max: MAX_NTH }))
    return { label, url, ...(anchor ? { anchor } : {}), ...(anchor && nth > 1 ? { nth } : {}) }
  }).filter((l, i, all) => all.findIndex(o => linkKey(o) === linkKey(l)) === i) // 同じリンクは 1 つにまとめる
}

const MAX_BADGES = 8
const MAX_BADGE_TEXT = 40

/**
 * 行のバッジ。[{ text, tone }] で受ける（tone は none・wait・hole・ok。省けば none）。
 * 中身は人かエージェントが決める。tadori は値を判定しない。直すときは全部を渡し直す（空の配列で消す）
 */
function badgeList(body: Record<string, unknown>): DailyBadge[] | undefined {
  const value = body.badges
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw new DailyInputError(t('badges must be [{ "text": text, "tone": none / wait / hole / ok }]'))
  if (value.length > MAX_BADGES) throw new DailyInputError(t('badges can have up to {max} items', { max: MAX_BADGES }))
  return value.map((raw, i) => {
    const badge = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
    const label = typeof badge.text === 'string' ? badge.text.replace(/[\t\r\n]+/g, ' ').trim() : ''
    const tone = badge.tone === undefined || badge.tone === '' ? 'none' : String(badge.tone)
    const no = i + 1
    if (!label || label.length > MAX_BADGE_TEXT || label.includes('|')) throw new DailyInputError(t('badges item {no}: the text must be 1–{max} characters and must not contain "|"', { no, max: MAX_BADGE_TEXT }))
    if (!(BADGE_TONES as readonly string[]).includes(tone)) throw new DailyInputError(t('badges item {no}: tone must be one of {list}', { no, list: BADGE_TONES.join(' / ') }))
    return { text: label, tone: tone as BadgeTone }
  })
}

const MAX_NTH = 20
const linkKey = (l: DailyLink) => `${l.label}\t${l.url}\t${l.anchor ?? ''}\t${l.nth ?? 1}`

/** text の中で、word の nth 回目が始まる位置（無ければ -1） */
export function nthIndexOf(text: string, word: string, nth = 1): number {
  let at = -1
  for (let i = 0; i < nth; i += 1) {
    at = text.indexOf(word, at + 1)
    if (at < 0) return -1
  }
  return at
}

/** 本文に見つからない語（画面では行末に「表示名 ↗」で出る）を、エージェントと人に知らせる文にする */
export function anchorWarnings(entry: DailyEntry): string[] {
  return (entry.links ?? []).flatMap(l => {
    if (!l.anchor || nthIndexOf(entry.text, l.anchor, l.nth ?? 1) >= 0) return []
    const vars = { label: l.label, anchor: l.anchor, nth: l.nth ?? 1 }
    return [(l.nth ?? 1) > 1
      ? t('Link "{label}": occurrence {nth} of the word "{anchor}" is not in the text (the screen shows "{label} ↗" at the end of the line instead)', vars)
      : t('Link "{label}": the word "{anchor}" is not in the text (the screen shows "{label} ↗" at the end of the line instead)', vars)]
  })
}

const wbsList = (body: Record<string, unknown>): string[] | undefined => {
  const value = body.wbs
  if (value === undefined) return undefined
  const list = Array.isArray(value) ? value : String(value).split(/[、,]/)
  return list.map(v => String(v).trim()).filter(Boolean)
}

const asBody = (body: unknown): Record<string, unknown> => {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new DailyInputError(t('Send a JSON object'))
  return body as Record<string, unknown>
}

/** 行を足す（人かエージェントが書いた行。作り直しても残る） */
export async function addDaily(dir: string, date: string, input: unknown): Promise<{ entry: DailyEntry; commit: CommitResult; warnings: string[] }> {
  const body = asBody(input)
  const { entries } = await mergedEntries(dir, date)
  const used = new Set(entries.map(e => e.id))
  let n = 1
  while (used.has(`m${n}`)) n += 1
  const issue = text(body, 'issue', false)
  const note = text(body, 'note', false)
  const chosenTag = tag(body)
  const links = linkList(body)
  const badges = badgeList(body)
  const chosenSection = section(body, true) as DailySection
  // 課題ごとの要約は、課題を付けて 1 日 1 課題に 1 つ（2 つ目は今ある要約を直してもらう）
  if (chosenSection === 'summary') {
    if (!issue) throw new DailyInputError(t('A summary needs issue (the summary is one per issue)'))
    const same = entries.find(e => e.section === 'summary' && e.issue === issue && e.origin !== 'removed')
    if (same) throw new DailyInputError(t('{issue} already has a summary for this day ({id}). Edit that row instead', { issue, id: same.id }))
  }
  const entry: DailyEntry = await withIssueHead(dir, {
    id: `m${n}`,
    who: text(body, 'who', false) ?? '',
    section: chosenSection,
    text: text(body, 'text', true) as string,
    wbs: wbsList(body) ?? [],
    ...(issue ? { issue } : {}),
    ...(note ? { note } : {}),
    ...(chosenTag ? { tag: chosenTag } : {}),
    ...(links?.length ? { links } : {}),
    ...(badges?.length ? { badges } : {}),
    origin: 'manual',
  })
  const commit = await writeDaily(dir, date, [...entries, entry], t('Add a line to daily progress ({date})', { date }))
  return { entry, commit, warnings: anchorWarnings(entry) }
}

/**
 * 課題のある行の頭に、自動の行と同じ「課題番号 短い件名 」を付ける（読み上げで、どの課題の話か分かるように）。
 * もう課題番号で始まっていれば付けない（二重にしない）。短い件名は台帳の short 列、無ければ title
 */
async function withIssueHead(dir: string, entry: DailyEntry): Promise<DailyEntry> {
  if (!entry.issue || entry.text.startsWith(`${entry.issue} `) || entry.text === entry.issue) return entry
  const item = (await loadProject(dir)).items.find(i => i.id === entry.issue)
  const name = item ? (item.fields.short || item.title) : ''
  return { ...entry, text: `${entry.issue} ${name ? `${name} ` : ''}${entry.text}` }
}

/** 行を直す。自動の行は「直した」になり、作り直しても上書きされない */
export async function updateDaily(dir: string, date: string, id: string, input: unknown): Promise<{ entry: DailyEntry; commit: CommitResult; warnings: string[] }> {
  const body = asBody(input)
  const { entries } = await mergedEntries(dir, date)
  const current = entries.find(e => e.id === id && visible(e))
  if (!current) throw new DailyInputError(t('No line {id} on {date}', { id, date }), 404)
  // 直すときは、空文字（links・wbs は空の配列や空文字・null も）を「その欄を空にする」と読む。
  // 本文だけは空の行を作らないよう断る（行ごと消すなら daily_remove）
  const isCleared = (key: string) => body[key] === '' || body[key] === null
  if (isCleared('text')) throw new DailyInputError(t('text cannot be empty (use daily_remove to delete the whole line)'))
  const patch = {
    who: isCleared('who') ? '' : text(body, 'who', false),
    section: section(body, false),
    text: text(body, 'text', false),
    wbs: isCleared('wbs') ? [] : wbsList(body),
    issue: isCleared('issue') ? '' : text(body, 'issue', false),
    note: isCleared('note') ? '' : text(body, 'note', false),
    tag: isCleared('tag') ? '' : tag(body),
    links: isCleared('links') ? [] : linkList(body),
    badges: isCleared('badges') ? [] : badgeList(body),
  }
  const changed = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined))
  // 本文か課題を変えたときだけ、課題番号と短い件名を頭に付け直す
  const filled: DailyEntry = { ...current, ...changed, origin: current.origin === 'manual' ? 'manual' : 'edited' }
  // 空にした欄は、行から外す（日ごとのファイルにも空で書く）
  const { issue, note, tag: entryTag, links, badges, ...rest } = filled
  const merged: DailyEntry = {
    ...rest,
    ...(issue ? { issue } : {}),
    ...(note ? { note } : {}),
    ...(entryTag ? { tag: entryTag } : {}),
    ...(links?.length ? { links } : {}),
    ...(badges?.length ? { badges } : {}),
  }
  const entry = patch.text !== undefined || patch.issue !== undefined ? await withIssueHead(dir, merged) : merged
  const commit = await writeDaily(dir, date, entries.map(e => (e.id === id ? entry : e)), t('Edit daily progress line {id} ({date})', { id, date }))
  return { entry, commit, warnings: anchorWarnings(entry) }
}

/** 行を消す。自動の行は「消した」印を残し、作り直しても戻ってこないようにする。足した行はそのまま消す */
export async function removeDaily(dir: string, date: string, id: string): Promise<{ commit: CommitResult }> {
  const { entries } = await mergedEntries(dir, date)
  const current = entries.find(e => e.id === id && visible(e))
  if (!current) throw new DailyInputError(t('No line {id} on {date}', { id, date }), 404)
  const next = current.origin === 'manual'
    ? entries.filter(e => e.id !== id)
    : entries.map(e => (e.id === id ? { ...e, origin: 'removed' as const } : e))
  return { commit: await writeDaily(dir, date, next, t('Remove daily progress line {id} ({date})', { id, date })) }
}
