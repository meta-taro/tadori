import { describe, expect, test } from 'vitest'
import { resolvedItems } from '../src/usecase/history.js'

const record = (when: string, what: string, result: string) => ({ when, who: 'エージェント', what, where: '.', why: '試し', how: 'tadori check', result })

describe('resolvedItems', () => {
  test('前のチェックで漏れだった行のうち、いま漏れの無い行を対応済みとして返す', () => {
    const checks = [
      record('2026-10-30 09:00', 'R4 · 改修後の対応', '漏れ 2 件（DD-2.3・DD-3.2）'),
      record('2026-10-30 09:00', 'R9 · 試験の記録', '漏れ 1 件（TC-04）'),
    ]
    const currentLeaks = [{ rule: 'R4', itemId: 'DD-2.3', message: '' }]
    expect(resolvedItems(checks, currentLeaks)).toEqual([
      { itemId: 'DD-3.2', rule: 'R4', when: '2026-10-30 09:00' },
      { itemId: 'TC-04', rule: 'R9', when: '2026-10-30 09:00' },
    ])
  })

  test('同じ行が何度も漏れだったら、最後に漏れだったチェックを使う', () => {
    const checks = [
      record('2026-10-20 09:00', 'R4 · x', '漏れ 1 件（DD-3.2）'),
      record('2026-10-30 09:00', 'R4 · x', '漏れ 1 件（DD-3.2）'),
    ]
    expect(resolvedItems(checks, [])).toEqual([{ itemId: 'DD-3.2', rule: 'R4', when: '2026-10-30 09:00' }])
  })

  test('「満たす」や人の行（承認・差し戻し）は対応済みの元にしない', () => {
    const checks = [record('2026-10-30 09:00', 'R3 · x', '満たす'), record('2026-10-20 15:30', 'R2 · 基本設計書', '差し戻し')]
    expect(resolvedItems(checks, [])).toEqual([])
  })
})
