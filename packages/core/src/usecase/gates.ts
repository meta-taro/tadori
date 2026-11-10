import { LEDGER_FILES, type ApprovalStatus, type Leak, type Phase, type Project, type Rule, type Task } from '../domain/model.js'

/** 承認待ち：どのルールか・いまの状態（差し戻し・待ち）・誰がどうすれば承認になるか */
export interface PendingApproval {
  readonly rule: Rule
  readonly status: ApprovalStatus
  readonly fix: string
  /** 承認のあとに、ルールが見る文書が commit された（承認待ちに戻った理由） */
  readonly changedAfter?: ChangeAfterApproval
}
import { approvalTargets, changedAfterApproval, type ChangeAfterApproval, type FileChange } from './approval-changes.js'
import { lateDays } from '../domain/schedule.js'
import { t } from '../i18n.js'

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
function pendingOf(project: Project, rule: Rule, changedAfter?: ChangeAfterApproval): PendingApproval {
  const record = project.approvals.find(a => a.rule === rule.id)
  const vars = { who: rule.owner ?? '', file: LEDGER_FILES.approvals, rule: rule.id }
  if (record && changedAfter) {
    // 承認は残したまま、変わった所を人が見直して日付を書き直せば、また承認になる
    const changeVars = { ...vars, changed: changedAfter.file, commit: changedAfter.commit }
    const fix = rule.owner !== undefined
      ? t('{who} looks at the change to {changed} ({commit}) and rewrites the date of the {rule} row in {file} to the day they looked', changeVars)
      : t('The approver looks at the change to {changed} ({commit}) and rewrites the date of the {rule} row in {file} to the day they looked', changeVars)
    return { rule, status: record.status, fix, changedAfter }
  }
  // 「承認」は approvals.tsv に書く値そのもの（データ）なので、英語の文でも訳さない
  const fix = rule.owner !== undefined
    ? (record
      ? t('{who} sets the status of the {rule} row in {file} to "approved", with their name and the date', vars)
      : t('{who} adds a {rule} row to {file} and sets its status to "approved", with their name and the date', vars))
    : (record
      ? t('The approver sets the status of the {rule} row in {file} to "approved", with their name and the date', vars)
      : t('The approver adds a {rule} row to {file} and sets its status to "approved", with their name and the date', vars))
  return { rule, status: record?.status ?? '待ち', fix }
}

function stateOf(leaks: readonly Leak[], pending: readonly Rule[]): GateState {
  if (leaks.length) return 'blocked'
  if (pending.length) return 'waiting'
  return 'clear'
}

/** 工程ごとに、漏れ・承認待ち・期間・いまのタスク・前の完了判定より前に着手・遅れを組み立てる */
/**
 * 承認のあとに見る文書が変わったルール（ルール ID → いちばん新しい変更）。
 * changes はファイルごとの最後の commit。渡されなければ何も見ない（承認の記録だけで決める）
 */
function changedApprovals(project: Project, changes: Readonly<Record<string, FileChange>>): Map<string, ChangeAfterApproval> {
  return new Map(project.rules.flatMap(rule => {
    const record = project.approvals.find(a => a.rule === rule.id && a.status === '承認')
    if (!record) return []
    const change = changedAfterApproval(record.when, approvalTargets(project, rule), changes)
    return change ? [[rule.id, change] as const] : []
  }))
}

/**
 * 工程ごとに、漏れ・承認待ち・期間・いまのタスク・前の完了判定より前に着手・遅れを組み立てる。
 * changes（ファイルごとの最後の commit）を渡すと、承認のあとに見る文書が変わった承認を承認待ちに戻す
 */
export function buildGates(project: Project, leaks: readonly Leak[], today: string, changes: Readonly<Record<string, FileChange>> = {}): Gate[] {
  const isDone = doneChecker(project)
  const notStarted = notStartedStatus(project)
  const phases = [...project.phases].sort((a, b) => a.order - b.order)
  const changed = changedApprovals(project, changes)
  const approved = new Set(project.approvals.filter(a => a.status === '承認' && !changed.has(a.rule)).map(a => a.rule))

  const base = phases.map(phase => {
    // 判定しない文のルール（note）は、工程の「ルールあり」に数えない（判定のルールが無い工程を、通ったように見せない）
    const rules = project.rules.filter(r => r.phase === phase.id && r.kind !== 'note')
    const ruleIds = new Set(rules.map(r => r.id))
    const phaseLeaks = leaks.filter(l => ruleIds.has(l.rule))
    const pendingApprovals = rules.filter(r => r.kind === 'approval' && !approved.has(r.id))
    const pending = pendingApprovals.map(rule => pendingOf(project, rule, changed.get(rule.id)))
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
