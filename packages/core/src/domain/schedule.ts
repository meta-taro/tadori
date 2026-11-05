import type { Task } from './model.js'

const MS_PER_DAY = 86_400_000

/** 'YYYY-MM-DD' を日数に直す（時差の影響を受けないよう UTC で数える） */
export const toDay = (iso: string): number => Math.floor(Date.parse(`${iso}T00:00:00Z`) / MS_PER_DAY)

/**
 * 終了予定を過ぎた日数。終わった作業・期間の入っていない作業・まだ予定内の作業は 0。
 * 今日は外から渡す（画面と判定と試験で同じ日を使うため）。
 */
export function lateDays(task: Task, today: string, isDone: (status: string) => boolean): number {
  if (isDone(task.status) || !task.end) return 0
  return Math.max(0, toDay(today) - toDay(task.end))
}
