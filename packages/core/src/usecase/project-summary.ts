import type { Project, Task } from '../domain/model.js'
import { lateDays } from '../domain/schedule.js'
import { runChecks } from './check.js'
import { buildGates, doneChecker } from './gates.js'
import type { FileChange } from './approval-changes.js'

/** 名指しで知らせられるよう、タスクの ID・名前・工程・担当を持つ */
export interface TaskFact {
  readonly id: string
  readonly name: string
  readonly phase: string
  readonly owner?: string
}

export interface LateTask extends TaskFact {
  readonly days: number
}

/**
 * 案件 1 つの「いま止まっている所」の事実。案件をまたいで並べるときに使う。
 * 件数・日数・名前だけを持ち、点数や割合は作らない（何を急ぐかは人が決める）。
 */
export interface ProjectSummary {
  readonly name: string
  readonly leaks: number
  readonly pendingApprovals: number
  /** 終了予定を過ぎて終わっていないタスク。遅れた日数の多い順 */
  readonly late: readonly LateTask[]
  /** 今日が終了予定で、まだ終わっていないタスク */
  readonly dueToday: readonly TaskFact[]
}

const factOf = (task: Task): TaskFact => ({
  id: task.id,
  name: task.name,
  phase: task.phase,
  ...(task.owner ? { owner: task.owner } : {}),
})

export function summarizeProject(project: Project, today: string, changes: Readonly<Record<string, FileChange>> = {}): ProjectSummary {
  const leaks = runChecks(project)
  const gates = buildGates(project, leaks, today, changes)
  const isDone = doneChecker(project)
  const late = project.tasks
    .map(task => ({ task, days: lateDays(task, today, isDone) }))
    .filter(x => x.days > 0)
    .sort((a, b) => b.days - a.days || a.task.id.localeCompare(b.task.id))
    .map(x => ({ ...factOf(x.task), days: x.days }))
  const dueToday = project.tasks.filter(t => t.end === today && !isDone(t.status)).map(factOf)
  return {
    name: project.name,
    leaks: leaks.length,
    pendingApprovals: gates.reduce((n, g) => n + g.pendingApprovals.length, 0),
    late,
    dueToday,
  }
}
