import { describe, expect, test } from 'vitest'
import { lateDays } from '../src/domain/schedule.js'

const task = (status: string, end?: string) => ({ id: 'W-1', phase: 'bd', name: 'タスク', status, ...(end ? { start: '2026-10-01', end } : {}) })
const isDone = (status: string) => status === 'done'

describe('lateDays', () => {
  test('終了予定を過ぎた日数を返す', () => {
    expect(lateDays(task('doing', '2026-10-30'), '2026-11-05', isDone)).toBe(6)
  })

  test('終了予定の当日と、それより前は 0', () => {
    expect(lateDays(task('doing', '2026-11-05'), '2026-11-05', isDone)).toBe(0)
    expect(lateDays(task('doing', '2026-12-01'), '2026-11-05', isDone)).toBe(0)
  })

  test('終わったタスクは遅れにしない', () => {
    expect(lateDays(task('done', '2026-10-01'), '2026-11-05', isDone)).toBe(0)
  })

  test('期間が入っていないタスクは遅れにしない', () => {
    expect(lateDays(task('doing'), '2026-11-05', isDone)).toBe(0)
  })
})
