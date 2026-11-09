import { entriesFromSheet, nextWorkday, originOf, type DailyEntry, type DailySheet, type Project } from '@tadori/core'
import { originText } from './format.js'

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
}

export const DEFAULT_DAILY_FORMAT: DailyFormat = {
  today: '今日（{date}）{count} 件',
  next: '次の作業日（{date}）',
  consult: '相談',
  notes: '補足',
  wbs: '{id}',
  continued: '',
  numbering: 'continuous',
  today_label: '今日',
  next_label: '次の作業日',
  consult_label: '相談',
  group_after: '3',
  intro: '',
  upkeep: '台帳の整備',
  upkeep_mode: 'show',
  tag_done: '済',
  tag_doing: '作業中',
  tag_plan: '予定',
  tag_upkeep: '整備',
  tag_checked: '確認',
  tag_format: '［{tag}］',
}

/** 行の頭に付ける印（言葉が空なら付けない） */
function tagText(tag: string | undefined, format: DailyFormat): string {
  if (!tag) return ''
  const word = (format as unknown as Record<string, string>)[`tag_${tag}`]
  return word ? fill(format.tag_format, { tag: word }) : ''
}

/** 案件の設定（key と value）を、既定の形に重ねる。知らない key は使わない */
export function dailyFormatOf(settings: Readonly<Record<string, string>>): DailyFormat {
  const keys = Object.keys(DEFAULT_DAILY_FORMAT) as Array<keyof DailyFormat>
  return { ...DEFAULT_DAILY_FORMAT, ...Object.fromEntries(keys.filter(k => k in settings).map(k => [k, settings[k] ?? ''])) }
}

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']
/** YYYY-MM-DD → M/D */
const md = (day: string | undefined) => (day ? `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}` : '')
/** YYYY-MM-DD → M/D 曜 */
const mdWeekday = (day: string) => `${md(day)} ${WEEKDAYS[new Date(`${day}T00:00:00Z`).getUTCDay()]}`
const fill = (template: string, values: Readonly<Record<string, string>>) =>
  template.replace(/\{(\w+)\}/g, (all, key: string) => values[key] ?? all)

const wbsLabel = (id: string, format: DailyFormat) => fill(format.wbs, { id, num: id.replace(/^W[-_ ]?/i, '') })

function statusName(project: Project, id: string): string {
  return project.statuses.find(s => s.id === id)?.name ?? id
}

/** 末尾の（WBS の番号 状態 期限・…）。WBS に行が無い作業は何も付けない */
function wbsTail(project: Project, ids: readonly string[], format: DailyFormat): string {
  if (!ids.length) return ''
  const parts = ids.map(id => {
    const t = project.tasks.find(task => task.id === id)
    return t ? [wbsLabel(t.id, format), statusName(project, t.status), md(t.end)].filter(Boolean).join(' ') : wbsLabel(id, format)
  })
  return `（${parts.join('・')}）`
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
    ...(issue ? [`課題 ${issue.id}：${issue.title}（${issue.source}）${originNote(project, issue, date)}`] : entry.issue ? [`課題 ${entry.issue}`] : []),
    ...entry.wbs.map(id => {
      const t = project.tasks.find(task => task.id === id)
      return t ? `${wbsLabel(t.id, format)}：${t.name}（${[phaseName(t.phase), t.start && t.end ? `${md(t.start)}〜${md(t.end)}` : ''].filter(Boolean).join('・')}）` : wbsLabel(id, format)
    }),
    ...(entry.note ? [entry.note] : []),
  ]
  return parts.length ? `${no}. ${parts.join('／')}` : null
}

export function formatEntries(entries: readonly DailyEntry[], project: Project, date: string, format: DailyFormat = DEFAULT_DAILY_FORMAT): string {
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
  const lines = (id: string) => (numbered.find(s => s.id === id)?.items ?? []).map(({ entry, no }) => `${no}. ${tagText(entry.tag, format)}${entry.text}${wbsTail(project, entry.wbs, format)}`)
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
