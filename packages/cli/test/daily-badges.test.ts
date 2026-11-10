import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { addDaily, DailyInputError, loadDaily, updateDaily } from '../src/daily.js'

// WBS（ledger/wbs.tsv）の無い、架空の最小の案件。バッジは WBS に依らずに書けて出ること
let dir = ''
const day = '2026-11-10'
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tadori-badges-'))
  const put = async (path: string, text: string) => {
    await mkdir(join(dir, path, '..'), { recursive: true })
    await writeFile(join(dir, path), text, 'utf8')
  }
  await put('.tadori/project.tsv', 'name\n架空の案件\n')
  await put('.tadori/phases.tsv', 'id\tname\torder\nbd\t基本設計\t1\n')
  await put('.tadori/statuses.tsv', 'id\tname\ttone\ntodo\t未着手\tnone\ndone\t完了\tok\n')
  await put('.tadori/rulesets/basic-design.tsv', 'id\tphase\tkind\tfrom\tto\tfield\tlabel\nR1\tbd\tapproval\t\t\t\t基本設計を承認した\n')
  await put('ledger/items.tsv', 'id\tkind\ttitle\tsource\trefs\n')
})
afterAll(async () => { await rm(dir, { recursive: true, force: true }) })

describe('1 日の進行の行のバッジ（文字と tone。WBS の無い案件でも使える）', () => {
  test('足した行にバッジを複数置け、日ごとのファイルに残り、文にも出る', async () => {
    const { entry } = await addDaily(dir, day, { who: '設計担当', section: 'today', text: '画面の設計', badges: [{ text: '遅延', tone: 'hole' }, { text: '確認待ち', tone: 'wait' }] })
    expect(entry.badges).toEqual([{ text: '遅延', tone: 'hole' }, { text: '確認待ち', tone: 'wait' }])
    expect(await readFile(join(dir, `.tadori/daily/${day}.tsv`), 'utf8')).toContain('hole 遅延 | wait 確認待ち')
    const daily = await loadDaily(dir, day)
    expect(daily.entries[0]?.badges).toEqual(entry.badges)
    expect(daily.text).toContain('画面の設計〈遅延〉〈確認待ち〉')
  })

  test('直すときはまとめて差し替え、空の配列で消す', async () => {
    const id = (await loadDaily(dir, day)).entries[0]?.id as string
    await updateDaily(dir, day, id, { badges: [{ text: '前倒し', tone: 'ok' }] })
    expect((await loadDaily(dir, day)).entries[0]?.badges).toEqual([{ text: '前倒し', tone: 'ok' }])
    await updateDaily(dir, day, id, { badges: [] })
    const after = (await loadDaily(dir, day)).entries[0]
    expect(after).not.toHaveProperty('badges')
    expect((await loadDaily(dir, day)).text).not.toContain('〈')
  })

  test('tone は none・wait・hole・ok だけ。空の文字・長すぎる文字・「|」は断る', async () => {
    const add = (badges: unknown) => addDaily(dir, day, { section: 'today', text: 'x', badges })
    await expect(add([{ text: '遅延', tone: 'red' }])).rejects.toThrow(DailyInputError)
    await expect(add([{ text: '', tone: 'hole' }])).rejects.toThrow(DailyInputError)
    await expect(add([{ text: 'あ'.repeat(41), tone: 'hole' }])).rejects.toThrow(DailyInputError)
    await expect(add([{ text: 'a|b', tone: 'hole' }])).rejects.toThrow(DailyInputError)
    await expect(add('遅延')).rejects.toThrow(DailyInputError)
  })

  test('tone を省くと none', async () => {
    const { entry } = await addDaily(dir, day, { section: 'consult', text: '相談', badges: [{ text: '期限 11/12' }] })
    expect(entry.badges).toEqual([{ text: '期限 11/12', tone: 'none' }])
  })
})
