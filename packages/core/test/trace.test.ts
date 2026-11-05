import { describe, expect, test } from 'vitest'
import { trace } from '../src/usecase/trace.js'
import { sampleProject } from './fixtures.js'

// 辿れる前提のテストで、null なら分かる言葉で落とす
const must = <T>(value: T | null): T => {
  if (value === null) throw new Error('trace が null を返しました')
  return value
}

describe('trace', () => {
  test('指摘から上流へ辿り、元から順に並べる', () => {
    const result = must(trace(sampleProject, 'F-1'))
    const ids = result.steps.filter(s => s.type === 'item').map(s => s.item.id)
    // F-1 → TC-2 → V-1 → DD-1 → BD-1（存在しない V-9 は辿れない）
    expect(ids).toEqual(['BD-1', 'DD-1', 'V-1', 'TC-2', 'F-1'])
  })

  test('辿った行がルールの求める先を持っていなければ、そこを切れ目として入れる', () => {
    const result = must(trace(sampleProject, 'F-1'))
    const missing = result.steps.filter(s => s.type === 'missing')
    expect(missing).toEqual([{ type: 'missing', after: 'TC-2', rule: 'R9', kind: 'RUN' }])
    // 切れ目は TC-2 の直後に来る
    const order = result.steps.map(s => (s.type === 'item' ? s.item.id : `missing:${s.after}`))
    expect(order.indexOf('missing:TC-2')).toBe(order.indexOf('TC-2') + 1)
  })

  test('下流（その行を元にしている行）も辿る', () => {
    const result = must(trace(sampleProject, 'BD-1'))
    const ids = result.steps.filter(s => s.type === 'item').map(s => s.item.id)
    expect(ids).toEqual(expect.arrayContaining(['BD-1', 'DD-1', 'DD-2', 'V-1', 'TC-1', 'TC-2', 'RUN-1', 'F-1']))
    expect(ids.at(0)).toBe('BD-1')
  })

  test('存在しない ID を渡したら null を返す', () => {
    expect(trace(sampleProject, 'X-1')).toBeNull()
  })
})
