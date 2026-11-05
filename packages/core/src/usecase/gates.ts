import { LEDGER_FILES, type ApprovalStatus, type Leak, type Phase, type Project, type Rule, type Task } from '../domain/model.js'

/** 承認待ち：どのルールか・いまの状態（差し戻し・待ち）・誰がどうすれば承認になるか */
export interface PendingApproval {
  readonly rule: Rule
  readonly status: ApprovalStatus
  readonly fix: string
}
import { lateDays } from '../domain/schedule.js'

export type GateState = 'blocked' | 'waiting' | 'clear'

/** 工程の完了判定。割合や点数は持たない。漏れと承認待ちの中身だけを持つ */
export interface Gate {
  readonly phase: Phase
  readonly rules: readonly Rule[]
  readonly leaks: readonly Leak[]
  readonly pendingApprovals: readonly Rule[]
  /** 承認待ちの中身（承認する人と承認のしかたつき） */
  readonly pending: readonly PendingApproval[]
  readonly state: GateState
  /** WBS のタスクの最初の開始日〜最後の終了日。期間が入っていなければ無い */
  readonly span?: { readonly start: string; readonly end: string }
  readonly tasks: readonly Task[]
  /** 終わっていないタスクのうち、WBS 番号がいちばん若いもの */
  readonly currentTask?: Task
  /** 前の工程の完了判定を通っていないのに、この工程のタスクが動いているとき、その前の工程 */
  readonly startedBefore?: Phase
  readonly maxLateDays: number
}

/** ステータスの設定で tone が ok のものを「終わった」とみなす */
function doneChecker(project: Project): (status: string) => boolean {
  const done = new Set(project.statuses.filter(s => s.tone === 'ok').map(s => s.id))
  return status => done.has(status)
}

/** 未着手のステータス：設定の最初のもの（並び順で決める） */
function notStartedStatus(project: Project): string | undefined {
  return project.statuses.at(0)?.id
}

function spanOf(tasks: readonly Task[]): Gate['span'] {
  if (!tasks.length || tasks.some(t => !t.start || !t.end)) return undefined
  const starts = tasks.map(t => t.start as string).sort()
  const ends = tasks.map(t => t.end as string).sort()
  return { start: starts.at(0) as string, end: ends.at(-1) as string }
}

/**
 * 承認待ちの中身。承認するのは人なので、誰が・どのファイルに・何を書けば承認になるかを案内する
 * （tadori もエージェントも、代わりに承認しない）。
 */
function pendingOf(project: Project, rule: Rule): PendingApproval {
  const record = project.approvals.find(a => a.rule === rule.id)
  const who = rule.owner ?? '承認する人'
  const fix = record
    ? `${who}が ${LEDGER_FILES.approvals} の ${rule.id} の行の状態を「承認」にする（名前と日付も書く）`
    : `${who}が ${LEDGER_FILES.approvals} に ${rule.id} の行を足し、状態を「承認」にする（名前と日付も書く）`
  return { rule, status: record?.status ?? '待ち', fix }
}

function stateOf(leaks: readonly Leak[], pending: readonly Rule[]): GateState {
  if (leaks.length) return 'blocked'
  if (pending.length) return 'waiting'
  return 'clear'
}

/** 工程ごとに、漏れ・承認待ち・期間・いまのタスク・前の完了判定より前に着手・遅れを組み立てる */
export function buildGates(project: Project, leaks: readonly Leak[], today: string): Gate[] {
  const isDone = doneChecker(project)
  const notStarted = notStartedStatus(project)
  const phases = [...project.phases].sort((a, b) => a.order - b.order)
  const approved = new Set(project.approvals.filter(a => a.status === '承認').map(a => a.rule))

  const base = phases.map(phase => {
    const rules = project.rules.filter(r => r.phase === phase.id)
    const ruleIds = new Set(rules.map(r => r.id))
    const phaseLeaks = leaks.filter(l => ruleIds.has(l.rule))
    const pendingApprovals = rules.filter(r => r.kind === 'approval' && !approved.has(r.id))
    const pending = pendingApprovals.map(rule => pendingOf(project, rule))
    const tasks = project.tasks.filter(t => t.phase === phase.id)
    const open = tasks.filter(t => !isDone(t.status)).sort((a, b) => a.id.localeCompare(b.id))
    return {
      phase,
      rules,
      leaks: phaseLeaks,
      pendingApprovals,
      pending,
      state: stateOf(phaseLeaks, pendingApprovals),
      tasks,
      open,
      started: tasks.some(t => t.status !== notStarted),
    }
  })

  return base.map((g, index) => {
    const earlierOpen = base.slice(0, index).find(prev => prev.state !== 'clear')
    const span = spanOf(g.tasks)
    const current = g.open.at(0)
    const startedBefore = earlierOpen && g.started ? earlierOpen.phase : undefined
    return {
      phase: g.phase,
      rules: g.rules,
      leaks: g.leaks,
      pendingApprovals: g.pendingApprovals,
      pending: g.pending,
      state: g.state,
      tasks: g.tasks,
      maxLateDays: Math.max(0, ...g.tasks.map(t => lateDays(t, today, isDone))),
      ...(span ? { span } : {}),
      ...(current ? { currentTask: current } : {}),
      ...(startedBefore ? { startedBefore } : {}),
    }
  })
}
