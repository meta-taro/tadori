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

describe('formatCheck の「どの工程にも属さない漏れ」', () => {
  test('工程のルールの漏れは、その工程の欄だけに出し、「どの工程にも属さない漏れ」に重ねて出さない', async () => {
    const { state } = await loadState(EXAMPLE, '2026-11-05')
    const text = formatCheck(state)
    expect(text).not.toContain('どの工程にも属さない漏れ')
    expect(text.match(/R4 DD-2\.3/g)?.length).toBe(1)
  })
})

describe('formatCheck のルールが無い工程', () => {
  test('ルールが 1 つも無い工程は「残りなし」ではなく「ルールなし」と出す（通ったように見せない）', async () => {
    const { state } = await loadState(EXAMPLE, '2026-11-05')
    const noRules = { ...state, gates: state.gates.map(g => (g.phase.id === 'rel' ? { ...g, rules: [], leaks: [], pendingApprovals: [] } : g)) }
    expect(formatCheck(noRules)).toMatch(/■ リリース  ルールなし（まだ判定していません）/)
  })
})

describe('formatCheck の直し方', () => {
  test('漏れと承認待ちに、担当と直し方を出す', async () => {
    const { state } = await loadState(EXAMPLE, '2026-11-05')
    const text = formatCheck(state)
    expect(text).toContain('担当：設計担当　直し方：ledger/items.tsv の DD-2.3 の行（6 行目）の「改修後の対応」列に書く')
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

describe('loadState の正本（origins）', () => {
  test('source 列が正本の表（sources.tsv）にある行は、リンクと「反映が古いか」を持つ', async () => {
    const { state } = await loadState(EXAMPLE, '2026-11-05')
    expect(state.origins['F-02']).toMatchObject({ name: '指摘の台帳', url: 'https://issues.example.com/lend-v12', stale: true })
    expect(state.origins['DD-2.3']).toBeUndefined()
  })
})
