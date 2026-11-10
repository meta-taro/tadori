import type { Project } from '../domain/model.js'

/** statuses.tsv に無い状態と、その状態のタスク */
export interface UnknownTaskStatus {
  readonly status: string
  readonly taskIds: readonly string[]
}

/**
 * WBS のタスクのうち、状態が statuses.tsv に無いもの（空も含む）を、状態ごとにまとめる。
 * 一覧に無い状態は「始まっていて、終わっていない」として数えられ、遅れや前の工程より先の着手に出てしまうため、知らせる。
 * 読み込みは止めない（ほかの判定は使えるままにする）
 */
export function unknownTaskStatuses(project: Project): UnknownTaskStatus[] {
  const known = new Set(project.statuses.map(s => s.id))
  const byStatus = new Map<string, string[]>()
  for (const task of project.tasks) {
    if (known.has(task.status)) continue
    byStatus.set(task.status, [...(byStatus.get(task.status) ?? []), task.id])
  }
  return [...byStatus].map(([status, taskIds]) => ({ status, taskIds }))
}
