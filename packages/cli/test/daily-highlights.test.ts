import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { addDaily, DailyInputError, loadDaily, updateDaily } from '../src/daily.js'

// 架空の最小の案件。本文の語の印（要点・注意）を書けて、日ごとのファイルに残り、コピーする文は本文のままであること
let dir = ''
const day = '2026-11-10'
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tadori-highlights-'))
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


describe('1 日の進行の行の、本文の語の印（key＝要点・note＝注意）', () => {
  test('足した行に印を置け、日ごとのファイルに残る。文（コピーする文字）は本文のまま', async () => {
    const { entry, warnings } = await addDaily(dir, day, { who: '設計担当', section: 'today', text: '結合試験を始めた。期限は明日。結合試験の結果は夕方に共有', highlights: [{ anchor: '期限は明日' }, { kind: 'note', anchor: '結合試験', nth: 2 }] })
    expect(entry.highlights).toEqual([{ kind: 'key', anchor: '期限は明日' }, { kind: 'note', anchor: '結合試験', nth: 2 }])
    expect(warnings).toEqual([])
    expect(await readFile(join(dir, `.tadori/daily/${day}.tsv`), 'utf8')).toContain('key 期限は明日 | note 結合試験 #2')
    const daily = await loadDaily(dir, day)
    expect(daily.entries[0]?.highlights).toEqual(entry.highlights)
    expect(daily.text).toContain('結合試験を始めた。期限は明日。結合試験の結果は夕方に共有')
  })

  test('本文に無い語は断らずに知らせる（画面では印を付けない）', async () => {
    const { warnings } = await addDaily(dir, day, { section: 'today', text: '画面を直した', highlights: [{ anchor: '試験' }] })
    expect(warnings.join('')).toContain('試験')
  })

  test('直すときはまとめて差し替え、空の配列で消す', async () => {
    const id = (await loadDaily(dir, day)).entries[0]?.id as string
    await updateDaily(dir, day, id, { highlights: [{ kind: 'note', anchor: '夕方' }] })
    expect((await loadDaily(dir, day)).entries[0]?.highlights).toEqual([{ kind: 'note', anchor: '夕方' }])
    await updateDaily(dir, day, id, { highlights: [] })
    expect((await loadDaily(dir, day)).entries[0]).not.toHaveProperty('highlights')
  })

  test('種類は key・note だけ。空の語・長すぎる語・「|」・末尾の「 #数」・範囲外の nth は断る', async () => {
    const add = (highlights: unknown) => addDaily(dir, day, { section: 'today', text: 'x', highlights })
    await expect(add([{ kind: 'bold', anchor: 'x' }])).rejects.toThrow(DailyInputError)
    await expect(add([{ anchor: '' }])).rejects.toThrow(DailyInputError)
    await expect(add([{ anchor: 'あ'.repeat(81) }])).rejects.toThrow(DailyInputError)
    await expect(add([{ anchor: 'a|b' }])).rejects.toThrow(DailyInputError)
    await expect(add([{ anchor: 'x #2' }])).rejects.toThrow(DailyInputError)
    await expect(add([{ anchor: 'x', nth: 0 }])).rejects.toThrow(DailyInputError)
    await expect(add('x')).rejects.toThrow(DailyInputError)
  })
})
