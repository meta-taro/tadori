import { describe, expect, test } from 'vitest'
import { buildGates } from '../src/usecase/gates.js'
import { runChecks } from '../src/usecase/check.js'
import { sampleProject } from './fixtures.js'

const TODAY = '2026-11-05'

describe('buildGates', () => {
  const gates = buildGates(sampleProject, runChecks(sampleProject), TODAY)
  const gate = (id: string) => {
    const g = gates.find(x => x.phase.id === id)
    if (!g) throw new Error(`gate ${id} not found`)
    return g
  }

  test('工程の順に並べる', () => {
    expect(gates.map(g => g.phase.id)).toEqual(['bd', 'dd', 'it'])
  })

  test('工程ごとに、その工程のルールの漏れを集める', () => {
    expect(gate('dd').leaks.map(l => l.rule).sort()).toEqual(['R3', 'R4'])
  })

  test('承認されていない人のルールは承認待ちにする（差し戻しも承認待ち）', () => {
    expect(gate('bd').pendingApprovals.map(r => r.id)).toEqual(['R2'])
  })

  test('漏れがあれば blocked、漏れが無く承認待ちがあれば waiting', () => {
    expect(gate('dd').state).toBe('blocked')
    expect(gate('bd').state).toBe('waiting')
  })

  test('WBS のタスクから工程の期間を出す', () => {
    expect(gate('bd').span).toEqual({ start: '2026-09-01', end: '2026-10-10' })
  })

  test('いまのタスクは、終わっていないタスクのうち最初のもの', () => {
    expect(gate('bd').currentTask?.id).toBe('W-2')
  })

  test('前の工程の完了判定を通っていないのにタスクが動いていれば、前の完了判定より前に着手とする', () => {
    expect(gate('dd').startedBefore?.id).toBe('bd')
    expect(gate('it').startedBefore).toBeUndefined() // 結合テストはまだ未着手
  })

  test('終わっていないタスクのいちばん大きい遅れの日数を出す', () => {
    expect(gate('bd').maxLateDays).toBe(26) // W-2 の終了予定 10/10 から 11/5 まで
  })
})
