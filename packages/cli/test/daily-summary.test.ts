import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { addDaily, DailyInputError, loadDaily } from '../src/daily.js'

// 架空の最小の案件。課題ごとの要約を足し、読み上げの文と詳しくの文を見比べる
let dir = ''
const day = '2026-11-12'
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tadori-summary-'))
  const put = async (path: string, text: string) => {
    await mkdir(join(dir, path, '..'), { recursive: true })
    await writeFile(join(dir, path), text, 'utf8')
  }
  await put('.tadori/project.tsv', 'name\n架空の案件\n')
  await put('.tadori/phases.tsv', 'id\tname\torder\nbd\t基本設計\t1\n')
  await put('.tadori/statuses.tsv', 'id\tname\ttone\ntodo\t未着手\tnone\ndone\t完了\tok\n')
  await put('.tadori/rulesets/basic-design.tsv', 'id\tphase\tkind\tfrom\tto\tfield\tlabel\nR1\tbd\tapproval\t\t\t\t基本設計を承認した\n')
  await put('ledger/items.tsv', 'id\tkind\ttitle\tsource\trefs\nBL-1\tBL\t貸出の上限\t\t\n')
  await addDaily(dir, day, { who: '設計担当', section: 'today', text: '設計書を直した', issue: 'BL-1' })
  await addDaily(dir, day, { who: '設計担当', section: 'today', text: '試験書を直した', issue: 'BL-1' })
  await addDaily(dir, day, { who: '設計担当', section: 'today', text: '朝会の準備' })
})
afterAll(async () => { await rm(dir, { recursive: true, force: true }) })

describe('課題ごとの要約', () => {
  test('要約は課題を付けて足す。課題の無い要約は断る', async () => {
    await expect(addDaily(dir, day, { who: '設計担当', section: 'summary', text: '進んだ' })).rejects.toThrow(DailyInputError)
    const { entry } = await addDaily(dir, day, { who: '設計担当', section: 'summary', issue: 'BL-1', text: '仕様変更があって、いまは結合試験の途中です。今日は終わりません' })
    expect(entry.section).toBe('summary')
    expect(entry.text).toContain('BL-1 貸出の上限')
  })

  test('同じ日・同じ課題の要約は 1 つだけ（2 つ目は直すように断る）', async () => {
    await expect(addDaily(dir, day, { who: '設計担当', section: 'summary', issue: 'BL-1', text: 'もう 1 つ' })).rejects.toThrow(/BL-1/)
  })

  test('読み上げの文は、要約のある課題を要約 1 行にし、細かい行を出さない', async () => {
    const read = await loadDaily(dir, day, undefined, { read: true })
    expect(read.text).toContain('結合試験の途中です')
    expect(read.text).not.toContain('設計書を直した')
    expect(read.text).toContain('朝会の準備')
  })

  test('詳しくの文（既定）は今までどおりで、要約の行は入らない。行の一覧には要約も入る', async () => {
    const detail = await loadDaily(dir, day)
    expect(detail.text).toContain('設計書を直した')
    expect(detail.text).not.toContain('結合試験の途中です')
    expect(detail.entries.some(e => e.section === 'summary')).toBe(true)
  })
})
