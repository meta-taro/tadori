import './i18n.js'
import {
  BADGE_TONES, buildDaily, checkReply, carriedOver, checkMarkOf, DAILY_SECTIONS, DAILY_TAGS, entriesFromSheet, loadProject, mergeDaily, ownersOf, previousDailyDate, readActivity, readDaily, readDailyFormat, readMembers,
  parseThread, readAloud, THREAD_SERVICE_NAMES, readCheckpointLog, readStatusChanges, runsById, staleWaits, t, withoutSummaries, writeDaily, type BadgeTone, type CheckMark, type CheckpointRun, type CommitResult, type DailyBadge, type DailyEntry, type DailyLink, type DailySection, type ReplyCheck, type ReplyReader,
  shortOf, type Item, type Task,
} from '@tadori/core'
import { checkMarkText, checkTagsOf, dailyFormatOf, formatEntries, staleRuleOf, tagText, wbsLabel, whoMark, type DailyFormat } from './daily-format.js'
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
  readonly links: readonly DailyTextLink[]
  /** 文の中の印の書き方（例：［済］）。画面が小さな札の見た目にする */
  readonly tags: readonly string[]
  /** 担当で絞っていないときに、行の頭に付く担当名の書き方（例：設計担当：）。画面が札の見た目にする。絞っているときは空 */
  readonly whoMarks: readonly string[]
  /**
   * 古いままの待ちの行（会議の前に直す行）。ids＝行の ID、hours＝何時間直していなければ古いとするか（案件の stale_hours）。
   * 待ちと読むのは、tone が wait のバッジか、案件が wait_words に書いた語を含む行だけ
   */
  readonly stale: { readonly ids: readonly string[]; readonly hours: number }
  /**
   * 行のしるし（つないだチェックの記録）。しるしの無い行（none）は入れない。
   * mark＝ok / open / missing、text＝案件の言葉（文に出すのと同じ）、runs＝つないだ記録（画面がその記録へ飛ぶ）
   */
  readonly marks: readonly DailyMark[]
  /** 待ちのスレッドを結んだ行の、チャットの名前（行の ID → Slack など）。画面のリンクの表示名に使う。読めない URL の行は入れない */
  readonly threads: Readonly<Record<string, string>>
  /** 待ちのスレッドに返事が来たか（行の ID → 答え）。読む口を渡して確かめたときだけ入る。本文は持たない */
  readonly replies: Readonly<Record<string, ReplyCheck>>
  /**
   * 課題の正本の工程表の行（課題 ID → 名前と URL）。案件の daily-format.tsv の issue_link_field に書いた列から読む。
   * 画面は、課題の付いた行と課題ごとの要約に「名前 ↗」を出す
   */
  readonly issueLinks: Readonly<Record<string, { readonly label: string; readonly url: string }>>
  /** issue_link_field を決めているのに、その列に URL の無い課題（台帳に無い課題も含む）。決めていなければ空 */
  readonly missingIssueLinks: readonly string[]
}

/**
 * 文の中の WBS・課題の書き方と飛び先。external＝正本（外のページ）へ飛ぶ。
 * assumed＝正本の工程表に行の無い作業（ほかの作業には正本の URL があるのに、この作業には無い。想定で置いた作業）
 */
export interface DailyTextLink {
  readonly text: string
  readonly href: string
  readonly external?: boolean
  readonly assumed?: boolean
}

export interface DailyMark {
  readonly id: string
  readonly mark: CheckMark
  readonly text: string
  readonly runs: readonly CheckpointRun[]
}

/** 行ごとのしるし（none の行は除く） */
export function marksOf(entries: readonly DailyEntry[], runs: ReadonlyMap<string, CheckpointRun>, format: DailyFormat): DailyMark[] {
  const required = checkTagsOf(format)
  return entries.flatMap(e => {
    const mark = checkMarkOf(e, runs, required)
    if (mark === 'none') return []
    return [{ id: e.id, mark, text: checkMarkText(mark, format), runs: (e.checks ?? []).flatMap(id => runs.get(id) ?? []) }]
  })
}

const pad2 = (n: number) => String(n).padStart(2, '0')
/** 行を直した時刻（その PC の時刻で YYYY-MM-DDTHH:MM。分まで） */
export const localStamp = (now: Date = new Date()): string =>
  `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}T${pad2(now.getHours())}:${pad2(now.getMinutes())}`

/**
 * 行がつながる WBS と課題の、文の中の書き方 → 画面の飛び先。
 * WBS は、正本の工程表の行の URL（wbs.tsv の url 列）があればそこへ、無ければプロダクトのその行へ。課題はつながりを辿る
 */
export function linksOf(entries: readonly DailyEntry[], format: DailyFormat, tasks: readonly Task[] = []): Daily['links'] {
  const urlOf = new Map(tasks.flatMap(task => (task.url ? [[task.id, task.url] as const] : [])))
  // 正本の URL を持つ作業が 1 つでもある案件だけ、URL の無い作業を「想定」と見分ける（どれにも無い案件では印を出さない）
  const hasSource = urlOf.size > 0
  const wbs = [...new Set(entries.flatMap(e => e.wbs))].map((id): DailyTextLink => {
    const url = urlOf.get(id)
    if (url) return { text: wbsLabel(id, format), href: url, external: true }
    return { text: wbsLabel(id, format), href: `#browse-${id}`, ...(hasSource ? { assumed: true } : {}) }
  })
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

/** 行に付いた課題の、正本の工程表の行（案件が issue_link_field で列を決めたときだけ） */
export function issueLinksOf(items: readonly Item[], entries: readonly DailyEntry[], format: DailyFormat): Pick<Daily, 'issueLinks' | 'missingIssueLinks'> {
  const field = format.issue_link_field.trim()
  if (!field) return { issueLinks: {}, missingIssueLinks: [] }
  const ids = [...new Set(entries.flatMap(e => (e.issue ? [e.issue] : [])))]
  const urlOf = (id: string) => {
    const value = (items.find(i => i.id === id)?.fields[field] ?? '').trim()
    return /^https?:\/\//i.test(value) ? value : ''
  }
  const label = format.issue_link_label.trim() || 'WBS'
  return {
    issueLinks: Object.fromEntries(ids.flatMap(id => (urlOf(id) ? [[id, { label, url: urlOf(id) }] as const] : []))),
    missingIssueLinks: ids.filter(id => !urlOf(id)),
  }
}

const visible = (e: DailyEntry) => e.origin !== 'removed'
const mine = (who?: string) => (e: DailyEntry) => !who || ownersOf(e.who).includes(who)

/** read：読み上げの文（課題ごとの要約があれば、その課題の今日の細かい行の代わりに要約を出す）。既定は詳しく（今までどおり） */
export interface DailyView {
  readonly read?: boolean
  /** 古い待ちの行を数えるときの「いま」（試験で時刻を決めるため。省けば今の時刻） */
  readonly now?: Date
  /**
   * 待ちのスレッドに返事が来たかを読む口。渡したときだけ確かめて replies に入れる（画面と MCP の daily が渡す）。
   * 省けばチャットへはつながない（試験や、nudge のように自分で確かめるところ）
   */
  readonly readers?: readonly ReplyReader[]
}

export async function loadDaily(dir: string, date: string, who?: string, view: DailyView = {}): Promise<Daily> {
  const project = await loadProject(dir)
  const { entries, saved } = await mergedEntries(dir, date)
  const shown = entries.filter(visible).filter(mine(who))
  // 担当の選択肢は、WBS の担当と、行の担当（commit やチェックの記録から来た人）の両方から
  const owners = [...new Set([...project.tasks.flatMap(t => ownersOf(t.owner)), ...entries.flatMap(e => ownersOf(e.who))])]
  const format = await formatOf(dir)
  const spoken = view.read ? readAloud(shown) : withoutSummaries(shown)
  const runs = runsById(await readCheckpointLog(dir))
  const marks = marksOf(shown, runs, format)
  const markById = new Map(marks.map(m => [m.id, m.mark]))
  const threaded = shown.flatMap(e => {
    const thread = parseThread(e.thread ?? '')
    return thread ? [{ id: e.id, thread }] : []
  })
  const threads = Object.fromEntries(threaded.map(({ id, thread }) => [id, THREAD_SERVICE_NAMES[thread.service]]))
  const readers = view.readers
  const replies = readers ? Object.fromEntries(await Promise.all(threaded.map(async ({ id, thread }) => [id, await checkReply(thread, readers)] as const))) : {}
  return { date, threads, replies, text: formatEntries(spoken, project, date, format, { showWho: !who, marks: markById, runs }), owners, entries: shown, saved, intro: format.intro, links: linksOf(shown, format, project.tasks), ...issueLinksOf(project.items, shown, format), tags: DAILY_TAGS.map(tag => tagText(tag, format)).filter(Boolean),
    whoMarks: who ? [] : [...new Set(shown.map(e => whoMark(e.who, format)).filter(Boolean))],
    stale: { ids: staleWaits(shown, view.now ?? new Date(), staleRuleOf(format)).map(e => e.id), hours: staleRuleOf(format).hours }, marks }
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

/**
 * 待ちの行に結ぶチャットのスレッドの URL。Slack・Discord・Google Chat・Teams・Chatwork・Mattermost の投稿の形だけを受ける（見分け方は core の domain/threads.ts の READERS）
 * （ほかの URL を断るのは、投稿先の取り違えに書いた時点で気づけるようにするため）。空文字は「外す」
 */
function threadValue(body: Record<string, unknown>): string | undefined {
  if (body.thread === undefined) return undefined
  const value = typeof body.thread === 'string' ? body.thread.trim() : ''
  if (!value) return ''
  const thread = parseThread(value)
  if (!thread) throw new DailyInputError(t('thread must be the URL of a chat post: Slack (https://<workspace>.slack.com/archives/<channel>/p<ts>), Discord (https://discord.com/channels/<server>/<channel>/<message>), Google Chat (https://chat.google.com/room/<space>/<thread>), Teams (https://teams.microsoft.com/l/message/<channel>/<message>), Chatwork (https://www.chatwork.com/#!rid<room>-<message>) or Mattermost (https://<host>/<team>/pl/<post>)'))
  return thread.url
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

const MAX_CHECKS = 8

/**
 * 行にしるしとしてつなぐチェックの記録の ID（.tadori/checkpoint-log.tsv の run）。配列か「,」区切りで受ける。
 * 記録に無い ID は断る（打ち間違いで、しるしが付いたように見えないように）。直すときは全部を渡し直す（空で外す）
 */
async function checkList(dir: string, body: Record<string, unknown>): Promise<string[] | undefined> {
  const value = body.checks
  if (value === undefined) return undefined
  const list = [...new Set((Array.isArray(value) ? value : String(value).split(/[、,]/)).map(v => String(v).trim()).filter(Boolean))]
  if (list.length > MAX_CHECKS) throw new DailyInputError(t('checks can have up to {max} items', { max: MAX_CHECKS }))
  if (!list.length) return list
  const runs = runsById(await readCheckpointLog(dir))
  const unknown = list.filter(id => !runs.has(id))
  if (unknown.length) throw new DailyInputError(t('No checkpoint record {ids}. Pass the record ID that checkpoint_record returned', { ids: unknown.join(', ') }))
  return list
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
  const checks = await checkList(dir, body)
  const thread = threadValue(body)
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
    ...(checks?.length ? { checks } : {}),
    ...(thread ? { thread } : {}),
    origin: 'manual',
    updated: localStamp(),
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
  const name = item ? (shortOf(item.id, item.fields.short) || item.title) : ''
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
    checks: isCleared('checks') ? [] : await checkList(dir, body),
    thread: isCleared('thread') ? '' : threadValue(body),
  }
  const changed = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined))
  // 本文か課題を変えたときだけ、課題番号と短い件名を頭に付け直す
  const filled: DailyEntry = { ...current, ...changed, origin: current.origin === 'manual' ? 'manual' : 'edited', updated: localStamp() }
  // 空にした欄は、行から外す（日ごとのファイルにも空で書く）
  const { issue, note, tag: entryTag, links, badges, checks, thread, ...rest } = filled
  const merged: DailyEntry = {
    ...rest,
    ...(issue ? { issue } : {}),
    ...(note ? { note } : {}),
    ...(entryTag ? { tag: entryTag } : {}),
    ...(links?.length ? { links } : {}),
    ...(badges?.length ? { badges } : {}),
    ...(checks?.length ? { checks } : {}),
    ...(thread ? { thread } : {}),
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
