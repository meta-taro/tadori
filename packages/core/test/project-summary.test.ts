import { describe, expect, test } from 'vitest'
import { buildGates } from '../src/usecase/gates.js'
import { runChecks } from '../src/usecase/check.js'
import { summarizeProject } from '../src/usecase/project-summary.js'
import { sampleProject } from './fixtures.js'

describe('summarizeProject', () => {
  test('漏れと承認待ちの件数は、工程の判定と同じ数を出す', () => {
    const today = '2026-10-31'
    const leaks = runChecks(sampleProject)
    const gates = buildGates(sampleProject, leaks, today)
    const summary = summarizeProject(sampleProject, today)
    expect(summary.name).toBe('見本')
    expect(summary.leaks).toBe(leaks.length)
    expect(summary.pendingApprovals).toBe(gates.reduce((n, g) => n + g.pendingApprovals.length, 0))
  })

  test('終了予定を過ぎて終わっていないタスクを、遅れた日数の多い順に並べる', () => {
    const summary = summarizeProject(sampleProject, '2026-11-02')
    // W-2 は 10/10 終わりのレビュー中（23 日）、W-3 は 10/31 終わりの進行中（2 日）。W-1 は完了なので入らない
    expect(summary.late.map(t => [t.id, t.days])).toEqual([['W-2', 23], ['W-3', 2]])
  })

  test('今日が終了予定で、まだ終わっていないタスクを並べる（遅れには入れない）', () => {
    const summary = summarizeProject(sampleProject, '2026-10-31')
    expect(summary.dueToday.map(t => t.id)).toEqual(['W-3'])
    expect(summary.late.map(t => t.id)).toEqual(['W-2'])
  })

  test('終わったタスクは、今日が終了予定でも入れない', () => {
    const summary = summarizeProject(sampleProject, '2026-09-30')
    expect(summary.dueToday).toEqual([])
  })

  test('担当があれば添える', () => {
    const project = { ...sampleProject, tasks: sampleProject.tasks.map(t => (t.id === 'W-2' ? { ...t, owner: 'レビュー担当' } : t)) }
    const summary = summarizeProject(project, '2026-10-12')
    expect(summary.late).toEqual([{ id: 'W-2', name: '基本設計レビュー', phase: 'bd', owner: 'レビュー担当', days: 2 }])
  })
})
