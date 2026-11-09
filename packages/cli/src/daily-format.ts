import './i18n.js'
import { entriesFromSheet, nextWorkday, originOf, t, type DailyEntry, type DailySheet, type Project } from '@tadori/core'
import { originText } from './format.js'
import { joinWords, listJoin, noteJoin } from './i18n.js'

/**
 * 「1 日の進行」の文。形（見出しの言葉・WBS の番号の書き方・続く作業の印）は案件ごとに違うので、
 * 案件の .tadori/daily-format.tsv（列 key・value）で決める。書かなければ下の既定の形にする。
 * 変わらないのは骨組みだけ：見出しは 今日 → 次の作業日 → 相談 → 補足 の順、番号は通し、
 * 本文に場所を挟まず、正式な名前と場所は同じ番号で補足に出す。
 */
export interface DailyFormat {
  /** 今日の見出し。{date}＝M/D 曜、{count}＝件数 */
  readonly today: string
  /** 次の作業日の見出し。{date} */
  readonly next: string
  /** 相談の見出し */
  readonly consult: string
  /** 補足の見出し */
  readonly notes: string
  /** WBS の番号の書き方。{id}＝ID そのまま、{num}＝ID の先頭の W と区切りを外したもの */
  readonly wbs: string
  /** 次の作業日も続く作業の頭に付ける印（空なら付けない。区切りが無ければ空白を 1 つ入れる） */
  readonly continued: string
  /** 番号の振り方：continuous＝見出しをまたいで通し / per-section＝見出しごとに 1 から */
  readonly numbering: string
  /** per-section のとき、補足を分ける名前 */
  readonly today_label: string
  readonly next_label: string
  readonly consult_label: string
  /** 台帳の同じ種類の行をこの数より多く足した・直した日は、種類ごとに 1 件にまとめる */
  readonly group_after: string
  /** 画面「1 日の進行」の頭に出す説明（空なら tadori の既定の説明） */
  readonly intro: string
  /** 台帳の整備（台帳の行を足した・直した）の見出し。相談のあと・補足の前に出す */
  readonly upkeep: string
  /** 台帳の整備を出すか：show＝出す / hide＝出さない */
  readonly upkeep_mode: string
  /** 行の印の言葉（空にすると、その印は出さない） */
  readonly tag_done: string
  readonly tag_doing: string
  readonly tag_plan: string
  readonly tag_upkeep: string
  readonly tag_checked: string
  /** 印の書き方（{tag}＝印の言葉） */
  readonly tag_format: string
  /** 担当で絞っていないときに、読み上げる行の頭に付ける担当名の書き方（{who}＝担当）。空なら付けない */
  readonly who_format: string
}

/**
 * 既定の形。言葉（見出し・印など）は読むときの言語に合わせる（getter なので、写したときの言語の言葉になる）。
 * 案件が .tadori/daily-format.tsv に書いた値は、そのまま使う（訳さない）
 */
export const DEFAULT_DAILY_FORMAT: DailyFormat = {
  get today() { return t('Today ({date}): {count}') },
  get next() { return t('Next working day ({date})') },
  get consult() { return t('Questions') },
  get notes() { return t('Notes') },
  wbs: '{id}',
  continued: '',
  numbering: 'continuous',
  get today_label() { return t('Today') },
  get next_label() { return t('Next working day') },
  get consult_label() { return t('Questions') },
  group_after: '3',
  intro: '',
  get upkeep() { return t('Ledger upkeep') },
  upkeep_mode: 'show',
  get tag_done() { return t('Done') },
  get tag_doing() { return t('In progress') },
  get tag_plan() { return t('Planned') },
  get tag_upkeep() { return t('Upkeep') },
  get tag_checked() { return t('Checked') },
  get tag_format() { return t('[{tag}] ') },
  get who_format() { return t('{who}: ') },
}

/** 行の頭に付ける印（言葉が空なら付けない） */
export function tagText(tag: string | undefined, format: DailyFormat): string {
  if (!tag) return ''
  const word = (format as unknown as Record<string, string>)[`tag_${tag}`]
  return word ? fill(format.tag_format, { tag: word }) : ''
}

/** 案件の設定（key と value）を、既定の形に重ねる。知らない key は使わない */
export function dailyFormatOf(settings: Readonly<Record<string, string>>): DailyFormat {
  const keys = Object.keys(DEFAULT_DAILY_FORMAT) as Array<keyof DailyFormat>
  return { ...DEFAULT_DAILY_FORMAT, ...Object.fromEntries(keys.filter(k => k in settings).map(k => [k, settings[k] ?? ''])) }
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
/** YYYY-MM-DD → M/D */
const md = (day: string | undefined) => (day ? `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}` : '')
/** YYYY-MM-DD → M/D 曜 */
const mdWeekday = (day: string) => `${md(day)} ${t(WEEKDAYS[new Date(`${day}T00:00:00Z`).getUTCDay()] ?? '')}`
const fill = (template: string, values: Readonly<Record<string, string>>) =>
  template.replace(/\{(\w+)\}/g, (all, key: string) => values[key] ?? all)

export const wbsLabel = (id: string, format: DailyFormat): string => fill(format.wbs, { id, num: id.replace(/^W[-_ ]?/i, '') })

function statusName(project: Project, id: string): string {
  return project.statuses.find(s => s.id === id)?.name ?? id
}

/** 末尾の（WBS の番号 状態 期限・…）。WBS に行が無い作業は何も付けない */
function wbsTail(project: Project, ids: readonly string[], format: DailyFormat): string {
  if (!ids.length) return ''
  const parts = ids.map(id => {
    const task = project.tasks.find(each => each.id === id)
    return task ? [wbsLabel(task.id, format), statusName(project, task.status), md(task.end)].filter(Boolean).join(' ') : wbsLabel(id, format)
  })
  return t(' ({list})', { list: listJoin(parts) })
}

/** 課題の正本へのリンクと反映の記録（正本の表に無ければ空） */
function originNote(project: Project, item: Project['items'][number], date: string): string {
  const origin = originOf(item, project.sources ?? [], date)
  return origin ? originText(origin) : ''
}

/** 補足の 1 行（正式な名前・WBS・場所）。補足するものが無ければ null */
function noteLine(project: Project, entry: DailyEntry, no: number, format: DailyFormat, date: string): string | null {
  const phaseName = (id: string) => project.phases.find(p => p.id === id)?.name ?? id
  const issue = entry.issue ? project.items.find(i => i.id === entry.issue) : undefined
  const parts = [
    ...(issue
      ? [joinWords(t('Issue {id}: {title} ({source})', { id: issue.id, title: issue.title, source: issue.source }), originNote(project, issue, date))]
      : entry.issue ? [t('Issue {id}', { id: entry.issue })] : []),
    ...entry.wbs.map(id => {
      const task = project.tasks.find(each => each.id === id)
      if (!task) return wbsLabel(id, format)
      const span = task.start && task.end ? t('{start}–{end}', { start: md(task.start), end: md(task.end) }) : ''
      return t('{wbs}: {name} ({detail})', { wbs: wbsLabel(task.id, format), name: task.name, detail: listJoin([phaseName(task.phase), span].filter(Boolean)) })
    }),
    ...(entry.note ? [entry.note] : []),
    // 行のリンクは読み上げる行には入れず、補足に「表示名：URL」で出す（聞かれたら開くもの）
    ...[...new Set((entry.links ?? []).map(l => t('{label}: {url}', { label: l.label, url: l.url })))], // 同じ表示名と URL は 1 回だけ
  ]
  return parts.length ? `${no}. ${noteJoin(parts)}` : null
}

/** 読み上げる行の頭に付ける担当名（例：設計担当：）。担当が無いか、書き方が空なら付けない */
export function whoMark(who: string, format: DailyFormat): string {
  return who && format.who_format ? fill(format.who_format, { who }) : ''
}

/** showWho：担当で絞っていない（全員の分を並べる）ときは、読み上げる行に担当名を入れる */
export interface FormatOptions {
  readonly showWho?: boolean
}

export function formatEntries(entries: readonly DailyEntry[], project: Project, date: string, format: DailyFormat = DEFAULT_DAILY_FORMAT, options: FormatOptions = {}): string {
  const whoText = (who: string) => (options.showWho ? whoMark(who, format) : '')
  const sections = [
    { id: 'today', label: format.today_label, list: entries.filter(e => e.section === 'today') },
    { id: 'next', label: format.next_label, list: entries.filter(e => e.section === 'next') },
    { id: 'consult', label: format.consult_label, list: entries.filter(e => e.section === 'consult') },
    // 台帳の整備（台帳の行を足した・直した）は、成果物の作業と読み違えないよう別の見出しにする。hide なら出さない
    { id: 'upkeep', label: format.upkeep, list: format.upkeep_mode === 'hide' ? [] : entries.filter(e => e.section === 'upkeep') },
  ]
  // 番号：既定は 今日 → 次の作業日 → 相談 の通し。per-section なら見出しごとに 1 から。補足は同じ番号を使う
  const perSection = format.numbering === 'per-section'
  let running = 0
  const numbered = sections.map(s => ({ ...s, items: s.list.map((entry, i) => ({ entry, no: perSection ? i + 1 : ++running })) }))
  const lines = (id: string) => (numbered.find(s => s.id === id)?.items ?? []).map(({ entry, no }) => `${no}. ${tagText(entry.tag, format)}${whoText(entry.who)}${entry.text}${wbsTail(project, entry.wbs, format)}`)
  const notes = numbered.flatMap(s => {
    const rows = s.items.flatMap(({ entry, no }) => noteLine(project, entry, no, format, date) ?? [])
    // 見出しごとに番号を振り直すときは、どの見出しの番号か分かるよう、補足を見出しの名前で分ける
    return perSection && rows.length ? [s.label, ...rows] : rows
  })
  const today = numbered[0]?.items.length ?? 0
  return [
    [fill(format.today, { date: mdWeekday(date), count: String(today) }), ...lines('today')].join('\n'),
    [fill(format.next, { date: mdWeekday(nextWorkday(date)) }), ...lines('next')].join('\n'),
    [format.consult, ...lines('consult')].join('\n'),
    ...(lines('upkeep').length ? [[format.upkeep, ...lines('upkeep')].join('\n')] : []),
    [format.notes, ...notes].join('\n'),
  ].join('\n\n')
}

/** WBS の変化だけから作った下書きの文（日ごとのファイルに置く前の形） */
export function formatDaily(sheet: DailySheet, project: Project, format: DailyFormat = DEFAULT_DAILY_FORMAT): string {
  return formatEntries(entriesFromSheet(sheet, format.continued), project, sheet.date, format)
}
