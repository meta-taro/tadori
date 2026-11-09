import { entriesFromSheet, nextWorkday, type DailyEntry, type DailySheet, type Project } from '@tadori/core'

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
  /** 次の作業日も続く作業の頭に付ける印（空なら付けない） */
  readonly continued: string
}

export const DEFAULT_DAILY_FORMAT: DailyFormat = {
  today: '今日（{date}）{count} 件',
  next: '次の作業日（{date}）',
  consult: '相談',
  notes: '補足',
  wbs: '{id}',
  continued: '',
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

/** 補足の 1 行（正式な名前・WBS・場所）。補足するものが無ければ null */
function noteLine(project: Project, entry: DailyEntry, no: number, format: DailyFormat): string | null {
  const phaseName = (id: string) => project.phases.find(p => p.id === id)?.name ?? id
  const issue = entry.issue ? project.items.find(i => i.id === entry.issue) : undefined
  const parts = [
    ...(issue ? [`課題 ${issue.id}：${issue.title}（${issue.source}）`] : entry.issue ? [`課題 ${entry.issue}`] : []),
    ...entry.wbs.map(id => {
      const t = project.tasks.find(task => task.id === id)
      return t ? `${wbsLabel(t.id, format)}：${t.name}（${[phaseName(t.phase), t.start && t.end ? `${md(t.start)}〜${md(t.end)}` : ''].filter(Boolean).join('・')}）` : wbsLabel(id, format)
    }),
    ...(entry.note ? [entry.note] : []),
  ]
  return parts.length ? `${no}. ${parts.join('／')}` : null
}

export function formatEntries(entries: readonly DailyEntry[], project: Project, date: string, format: DailyFormat = DEFAULT_DAILY_FORMAT): string {
  const today = entries.filter(e => e.section === 'today')
  const next = entries.filter(e => e.section === 'next')
  const consult = entries.filter(e => e.section === 'consult')
  // 番号は 今日 → 次の作業日 → 相談 の通し（補足と同じ番号にするため）
  const numbered = [...today, ...next, ...consult].map((entry, i) => ({ entry, no: i + 1 }))
  const lines = (list: readonly DailyEntry[]) =>
    numbered.filter(n => list.includes(n.entry)).map(({ entry, no }) => `${no}. ${entry.text}${wbsTail(project, entry.wbs, format)}`)
  return [
    [fill(format.today, { date: mdWeekday(date), count: String(today.length) }), ...lines(today)].join('\n'),
    [fill(format.next, { date: mdWeekday(nextWorkday(date)) }), ...lines(next)].join('\n'),
    [format.consult, ...lines(consult)].join('\n'),
    [format.notes, ...numbered.flatMap(({ entry, no }) => noteLine(project, entry, no, format) ?? [])].join('\n'),
  ].join('\n\n')
}

/** WBS の変化だけから作った下書きの文（日ごとのファイルに置く前の形） */
export function formatDaily(sheet: DailySheet, project: Project, format: DailyFormat = DEFAULT_DAILY_FORMAT): string {
  return formatEntries(entriesFromSheet(sheet, format.continued), project, sheet.date, format)
}
