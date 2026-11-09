import { describe, expect, test } from 'vitest'
import { isFor } from '../src/domain/people.js'

const members = [
  { name: '設計担当A', git: 'a', roles: ['設計担当', 'レビュー担当'] },
  { name: '検証担当B', git: 'b', roles: ['検証担当'] },
]

describe('isFor（その人の分か：名前で書かれたもの・その人の役割で書かれたもの）', () => {
  test('名前が一致すれば、その人の分', () => {
    expect(isFor('設計担当A', '設計担当A', members)).toBe(true)
    expect(isFor('設計担当A・検証担当B', '検証担当B', members)).toBe(true)
  })

  test('役割で書かれていても、その人の役割なら、その人の分（ルールの owner は役割）', () => {
    expect(isFor('レビュー担当', '設計担当A', members)).toBe(true)
    expect(isFor('検証担当', '設計担当A', members)).toBe(false)
  })

  test('表に無い人は、名前の一致だけで見る。だれも選んでいなければ全部その人の分', () => {
    expect(isFor('設計担当', '設計担当', [])).toBe(true)
    expect(isFor('設計担当', '検証担当', [])).toBe(false)
    expect(isFor(undefined, '', members)).toBe(true)
  })
})
