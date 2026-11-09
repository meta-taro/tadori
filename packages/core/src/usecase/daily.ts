import type { Item, Project, Task } from '../domain/model.js'

/**
 * 人単位の「1 日の進行」。プロダクト単位の残課題とは別に、人単位で見るためのもの。
 * tadori が出すのは下書き（骨組み）まで。「やったこと」の言い回し・話す順・相談は、人かエージェントが仕上げる。
 * 割合や点数は出さない。
 */

/** WBS のタスクの状態が変わったこと（git の履歴から読む。tadori は控えを持たない） */
export interface StatusChange {
  readonly taskId: string
  /** 変わった日（YYYY-MM-DD） */
  readonly date: string
  readonly from: string
  readonly to: string
}

/** 1 件。同じ課題につながる WBS の行は 1 件にまとめる */
export interface DailyLine {
  /** 補足と同じ番号（今日から次の作業日へ通しで振る） */
  readonly no: number
  /** この件の課題（WBS の issue 列に書かれた台帳の行）。無ければ WBS の行だけ */
  readonly issue?: Pick<Item, 'id' | 'kind' | 'title' | 'source'> & { readonly short?: string }
  readonly tasks: readonly Task[]
  /** その日に変わった状態（今日の件だけ） */
  readonly changes: readonly StatusChange[]
  /** 次の作業日も同じ作業が続く */
  readonly continued: boolean
}

export interface DailySheet {
  readonly date: string
  readonly nextDate: string
  readonly who?: string
  readonly today: readonly DailyLine[]
  readonly next: readonly DailyLine[]
}

const WEEKEND = new Set([0, 6])
const toUtc = (day: string) => new Date(`${day}T00:00:00Z`)
const fromUtc = (d: Date) => d.toISOString().slice(0, 10)

/** 次の平日（土日を飛ばす。祝日は見ない） */
export function nextWorkday(day: string): string {
  const d = toUtc(day)
  do d.setUTCDate(d.getUTCDate() + 1)
  while (WEEKEND.has(d.getUTCDay()))
  return fromUtc(d)
}

/** WBS の行の課題：その行の issue 列に書かれた台帳の行。推測でつながない（書かれていなければ課題なし） */
function issueOf(project: Project, task: Task): DailyLine['issue'] {
  if (!task.issue) return undefined
  const item = project.items.find(i => i.id === task.issue)
  const short = item?.fields.short?.trim()
  return item ? { id: item.id, kind: item.kind, title: item.title, source: item.source, ...(short ? { short } : {}) } : undefined
}

/** 並べたタスクを、続けて同じ課題のものは 1 件にまとめる（並びは崩さない） */
function group(project: Project, tasks: readonly Task[], changes: readonly StatusChange[], continuedIds: ReadonlySet<string>): Array<Omit<DailyLine, 'no'>> {
  const lines: Array<Omit<DailyLine, 'no'> & { tasks: Task[]; changes: StatusChange[] }> = []
  for (const task of tasks) {
    const issue = issueOf(project, task)
    const last = lines.at(-1)
    const own = changes.filter(c => c.taskId === task.id)
    if (issue && last?.issue?.id === issue.id) {
      last.tasks.push(task)
      last.changes.push(...own)
      continue
    }
    lines.push({ ...(issue ? { issue } : {}), tasks: [task], changes: [...own], continued: continuedIds.has(task.id) })
  }
  return lines
}

/** 担当の欄を人ごとに分ける（「A・B」「A、B」「A,B」「A/B」のように 2 人以上書かれることがある） */
export const ownersOf = (owner: string | undefined): string[] =>
  (owner ?? '').split(/[・、,，/／]/).map(s => s.trim()).filter(Boolean)

export function buildDaily(project: Project, changes: readonly StatusChange[], date: string, who?: string): DailySheet {
  const isDone = (status: string) => project.statuses.some(s => s.id === status && s.tone === 'ok')
  const isStarted = (status: string) => project.statuses.some(s => s.id === status && (s.tone === 'wait' || s.tone === 'hole'))
  const mine = project.tasks.filter(t => !who || ownersOf(t.owner).includes(who))
  const nextDate = nextWorkday(date)

  // 今日：その日に状態が変わったもの（変わった順）
  const todayChanges = changes.filter(c => c.date === date && mine.some(t => t.id === c.taskId))
  const todayTasks = [...new Set(todayChanges.map(c => c.taskId))].map(id => mine.find(t => t.id === id) as Task)

  // 次の作業日：済んでいないもののうち、続いている作業と、次の作業日までに始まる予定のもの（始まる順）
  const ongoing = mine.filter(t => isStarted(t.status))
  const starting = mine.filter(t => !isDone(t.status) && !isStarted(t.status) && t.start && t.start <= nextDate)
  const nextTasks = [...ongoing, ...starting.sort((a, b) => (a.start ?? '').localeCompare(b.start ?? ''))]

  const today = group(project, todayTasks, todayChanges, new Set())
  const next = group(project, nextTasks, [], new Set(ongoing.map(t => t.id)))
  const numbered = [...today, ...next].map((line, i) => ({ ...line, no: i + 1 }))
  return {
    date,
    nextDate,
    ...(who ? { who } : {}),
    today: numbered.slice(0, today.length),
    next: numbered.slice(today.length),
  }
}
