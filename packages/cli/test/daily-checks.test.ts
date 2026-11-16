import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { appendCheckpoint } from '@tadori/core'
import { addDaily, loadDaily, updateDaily } from '../src/daily.js'

// 架空の最小の案件（WBS なし）。1 日の進行の行に、チェックの記録をしるしとしてつなぐ
let dir = ''
const day = '2026-11-13'
const put = async (path: string, text: string) => {
  await mkdir(join(dir, path, '..'), { recursive: true })
  await writeFile(join(dir, path), text, 'utf8')
}
let okRun = ''
let openRun = ''

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tadori-checks-'))
  await put('.tadori/project.tsv', 'name\n架空の案件\n')
  await put('.tadori/phases.tsv', 'id\tname\torder\nbd\t基本設計\t1\n')
  await put('.tadori/statuses.tsv', 'id\tname\ttone\ntodo\t未着手\tnone\ndone\t完了\tok\n')
  await put('.tadori/rulesets/basic-design.tsv', 'id\tphase\tkind\tfrom\tto\tfield\tlabel\tat\tcheck\nR1\tbd\tnote\t\t\t\t画面の項目を仕様と突き合わせる\tbefore-judge\t仕様と 1 項目ずつ突き合わせたか\n')
  await put('ledger/items.tsv', 'id\tkind\ttitle\tsource\trefs\n')
  okRun = (await appendCheckpoint(dir, { at: 'before-judge', target: day, who: 'エージェント', answers: [{ rule: 'R1', result: 'ok', where: 'spec.md:12' }] })).run
  openRun = (await appendCheckpoint(dir, { at: 'before-judge', target: day, who: 'エージェント', answers: [{ rule: 'R1', result: 'open', where: 'spec.md:30', note: '項目の名前が違う。まだ直していない' }] })).run
})
afterAll(async () => { await rm(dir, { recursive: true, force: true }) })

describe('1 日の進行の行のしるし（チェックの記録）', () => {
  test('済の行に記録が無ければ missing。記録をつなぐと ok になり、文と補足に出る', async () => {
    const { entry } = await addDaily(dir, day, { section: 'today', text: '画面の項目を確かめた', tag: 'done' })
    expect((await loadDaily(dir, day)).marks).toEqual([expect.objectContaining({ id: entry.id, mark: 'missing', text: '〈チェックの記録なし〉' })])

    await updateDaily(dir, day, entry.id, { checks: [okRun] })
    const daily = await loadDaily(dir, day)
    expect(daily.marks[0]).toMatchObject({ id: entry.id, mark: 'ok', text: '〈チェック済み〉' })
    expect(daily.marks[0]?.runs.map(r => r.run)).toEqual([okRun])
    expect(daily.text).toContain('画面の項目を確かめた〈チェック済み〉')
    expect(daily.text).toContain(`チェックの記録 ${okRun}：before-judge：`)
  })

  test('まだ直していないミスのある記録をつなぐと open。空で外すと missing に戻る', async () => {
    const { entry } = await addDaily(dir, day, { section: 'today', text: '一覧を確かめた', tag: 'done', checks: `${okRun},${openRun}` })
    expect(entry.checks).toEqual([okRun, openRun])
    expect((await loadDaily(dir, day)).marks.find(m => m.id === entry.id)?.mark).toBe('open')
    await updateDaily(dir, day, entry.id, { checks: [] })
    expect((await loadDaily(dir, day)).marks.find(m => m.id === entry.id)?.mark).toBe('missing')
  })

  test('しるしを求めない行（予定など）は、記録が無くても marks に入らない', async () => {
    const { entry } = await addDaily(dir, day, { section: 'next', text: '次の画面', tag: 'plan' })
    expect((await loadDaily(dir, day)).marks.some(m => m.id === entry.id)).toBe(false)
  })

  test('記録に無い ID と、9 件以上は断る', async () => {
    await expect(addDaily(dir, day, { section: 'today', text: 'x', checks: ['nope'] })).rejects.toThrow(/nope/)
    await expect(addDaily(dir, day, { section: 'today', text: 'x', checks: Array.from({ length: 9 }, (_, i) => `r${i}`) })).rejects.toThrow(/8/)
  })
})
