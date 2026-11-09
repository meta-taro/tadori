import { describe, expect, test } from 'vitest'
import { isStale, originOf, sourceLinkOf, type SourceDef } from '../src/domain/sources.js'

// 架空の正本。URL は例のドメインだけ
const sources: SourceDef[] = [
  { name: '仕様書', url: 'https://docs.example.com/spec', locator: '', staleDays: 14 },
  { name: '試験シート', url: 'https://sheets.example.com/abc', locator: '{url}#range=A{num}', staleDays: 7 },
]

describe('sourceLinkOf（台帳の source 列から正本へのリンクを作る）', () => {
  test('source の先頭が設定の名前なら、その正本の URL。ひな形があれば場所の番号まで入れる', () => {
    expect(sourceLinkOf('仕様書 §2.3', sources)).toEqual({ name: '仕様書', url: 'https://docs.example.com/spec', place: '§2.3' })
    expect(sourceLinkOf('試験シート 15 行目', sources)).toEqual({ name: '試験シート', url: 'https://sheets.example.com/abc#range=A15', place: '15 行目' })
  })

  test('設定に無い名前は、リンクを作らない', () => {
    expect(sourceLinkOf('docs/detail-design.md §2.3', sources)).toBeUndefined()
    expect(sourceLinkOf('', sources)).toBeUndefined()
  })
})

describe('isStale（正本から手元へ反映してから日が経っているか）', () => {
  test('設定の日数を超えたら古い。反映した記録が無いものも古い', () => {
    expect(isStale('2026-11-01 10:00', '2026-11-09', 7)).toBe(true)
    expect(isStale('2026-11-05 10:00', '2026-11-09', 7)).toBe(false)
    expect(isStale(undefined, '2026-11-09', 7)).toBe(true)
  })
})

describe('originOf（台帳の行の正本と、手元へ反映した記録）', () => {
  const item = (fields: Record<string, string>, source = '試験シート 15 行目') => ({ id: 'TC-1', kind: 'TC', title: 't', source, refs: [], fields })

  test('正本へのリンクに、反映した日時・だれが・古いかを添える', () => {
    expect(originOf(item({ synced_at: '2026-11-08 09:00', synced_by: '検証担当' }), sources, '2026-11-09')).toEqual({
      name: '試験シート', url: 'https://sheets.example.com/abc#range=A15', place: '15 行目', syncedAt: '2026-11-08 09:00', syncedBy: '検証担当', stale: false,
    })
    expect(originOf(item({}), sources, '2026-11-09')).toMatchObject({ stale: true })
    expect(originOf(item({}), sources, '2026-11-09')).not.toHaveProperty('syncedAt')
  })

  test('正本の設定に無い行は undefined（古いとも言わない）', () => {
    expect(originOf(item({}, 'docs/a.md'), sources, '2026-11-09')).toBeUndefined()
  })
})
