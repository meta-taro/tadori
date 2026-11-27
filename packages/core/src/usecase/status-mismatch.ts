import type { StatusDef, Task } from '../domain/model.js'
import type { DailyEntry } from './daily-entries.js'

/**
 * 工程（WBS の作業）の状態と、その工程に当たっている 1 日の進行の行の印の食い違い。
 * 例：行に「作業中」「やり終えた」があるのに工程は未着手のまま／工程は終えたのに行に「予定」「作業中」がある。
 * 台帳の status の直し忘れに、会の前に気づけるようにする（どちらが正しいかは決めない。人が直す）
 */
export interface StatusMismatch {
  /** WBS の作業 ID */
  readonly task: string
  /** 作業の名前 */
  readonly name: string
  /** 作業の今の状態の名前（statuses.tsv の name） */
  readonly status: string
  /** 工程の段（todo＝まだ始めていない・done＝終えた） */
  readonly stage: 'todo' | 'done'
  /** 食い違っている行の印（重ねない） */
  readonly tags: readonly string[]
  /** 食い違っている行の ID */
  readonly rows: readonly string[]
}

/**
 * 状態の段。statuses.tsv の決まり（1 行目は「まだ始めていない」、tone が ok の状態は「終わった」）で読む。
 * 遅れの日数と同じ読み方にそろえる。ほかの状態は「始まっていて、終わっていない」なので食い違いを見ない
 */
export function stageOf(status: string, statuses: readonly StatusDef[]): 'todo' | 'done' | undefined {
  const def = statuses.find(s => s.id === status || s.name === status)
  if (!def) return undefined
  if (def === statuses[0]) return 'todo'
  return def.tone === 'ok' ? 'done' : undefined
}

/** 工程が「まだ始めていない」のに付いていると食い違う印と、「終えた」のに付いていると食い違う印 */
const CONFLICTS: Readonly<Record<'todo' | 'done', readonly string[]>> = { todo: ['doing', 'done'], done: ['plan', 'doing'] }

/** その日の行のうち、当たっている工程の状態と印が食い違うもの（工程ごとにまとめる） */
export function statusMismatches(entries: readonly DailyEntry[], tasks: readonly Task[], statuses: readonly StatusDef[]): StatusMismatch[] {
  return tasks.flatMap(task => {
    const stage = stageOf(task.status, statuses)
    if (!stage) return []
    const rows = entries.filter(e => e.origin !== 'removed' && e.tag && e.wbs.includes(task.id) && CONFLICTS[stage].includes(e.tag))
    if (!rows.length) return []
    const def = statuses.find(s => s.id === task.status || s.name === task.status)
    return [{ task: task.id, name: task.name, status: def?.name ?? task.status, stage, tags: [...new Set(rows.map(e => e.tag as string))], rows: rows.map(e => e.id) }]
  })
}
