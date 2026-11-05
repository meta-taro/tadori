import { describe, expect, test } from 'vitest'
import { resolve } from 'node:path'
import { trace } from '@tadori/core'
import { loadState } from '../src/state.js'
import { formatCheck, formatTrace } from '../src/format.js'

const EXAMPLE = resolve(import.meta.dirname, '../../../examples/lend-v12')

describe('formatCheck', () => {
  test('工程ごとに漏れと承認待ちを並べ、最後に合計を出す。割合は出さない', async () => {
    const { state } = await loadState(EXAMPLE, '2026-11-05')
    const text = formatCheck(state)
    expect(text).toMatch(/基本設計.*承認待ち 1/)
    expect(text).toMatch(/詳細設計.*基本設計の完了判定より前に着手/)
    expect(text).toMatch(/R9 .*TC-07/)
    expect(text).toMatch(/漏れ \d+ 件 \/ 承認待ち \d+ 件/)
    expect(text).not.toMatch(/%/)
  })
})

describe('formatCheck の直し方', () => {
  test('漏れと承認待ちに、担当と直し方を出す', async () => {
    const { state } = await loadState(EXAMPLE, '2026-11-05')
    const text = formatCheck(state)
    expect(text).toContain('担当：設計担当　直し方：ledger/items.tsv の DD-2.3 の行の「改修後の対応」列に書く')
    expect(text).toContain('R2 承認待ち（差し戻し）　直し方：レビュー担当が ledger/approvals.tsv の R2 の行の状態を「承認」にする')
  })
})

describe('formatTrace', () => {
  test('元から順に並べ、切れ目には ✗ と足りない種類を出す', async () => {
    const { project } = await loadState(EXAMPLE, '2026-11-05')
    const result = trace(project, 'F-02')
    if (!result) throw new Error('F-02 が辿れません')
    const lines = formatTrace(result).split('\n')
    const at = (s: string) => lines.findIndex(l => l.includes(s))
    expect(at('BD-3')).toBeLessThan(at('TC-07'))
    expect(lines.at(at('TC-07') + 1)).toMatch(/✗.*RUN.*R9/)
  })

  test('つながり以外の漏れ（列が空など）がある行は ✗ にして、漏れの中身を下に出す', async () => {
    const { project } = await loadState(EXAMPLE, '2026-11-05')
    const result = trace(project, 'DD-2.3')
    if (!result) throw new Error('DD-2.3 が辿れません')
    const lines = formatTrace(result).split('\n')
    const at = lines.findIndex(l => l.includes('DD-2.3'))
    expect(lines.at(at)).toMatch(/^▶/) // 辿り始めは ▶ のまま
    expect(lines.at(at + 1)).toMatch(/漏れ R4/)
  })
})
