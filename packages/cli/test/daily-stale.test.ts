import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { addDaily, loadDaily, localStamp, updateDaily } from '../src/daily.js'

// 架空の最小の案件（WBS なし）。行ごとの更新時刻と、古いままの待ちの行
let dir = ''
const day = '2026-11-13'
const put = async (path: string, text: string) => {
  await mkdir(join(dir, path, '..'), { recursive: true })
  await writeFile(join(dir, path), text, 'utf8')
}
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tadori-stale-'))
  await put('.tadori/project.tsv', 'name\n架空の案件\n')
  await put('.tadori/phases.tsv', 'id\tname\torder\nbd\t基本設計\t1\n')
  await put('.tadori/statuses.tsv', 'id\tname\ttone\ntodo\t未着手\tnone\ndone\t完了\tok\n')
  await put('.tadori/rulesets/basic-design.tsv', 'id\tphase\tkind\tfrom\tto\tfield\tlabel\nR1\tbd\tapproval\t\t\t\t基本設計を承認した\n')
  await put('ledger/items.tsv', 'id\tkind\ttitle\tsource\trefs\n')
})
afterAll(async () => { await rm(dir, { recursive: true, force: true }) })

const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/

describe('1 日の進行の行ごとの更新時刻', () => {
  test('足した行・直した行に、その PC の時刻（分まで）が付き、日ごとのファイルに残る', async () => {
    const { entry } = await addDaily(dir, day, { section: 'today', text: '仕様を確認中' })
    expect(entry.updated).toMatch(STAMP)
    const { entry: edited } = await updateDaily(dir, day, entry.id, { tag: 'doing' })
    expect(edited.updated).toMatch(STAMP)
    const file = await readFile(join(dir, `.tadori/daily/${day}.tsv`), 'utf8')
    expect(file.split('\n')[0]).toMatch(/\tupdated$/)
    expect((await loadDaily(dir, day)).entries.find(e => e.id === entry.id)?.updated).toBe(edited.updated)
  })

  test('localStamp は YYYY-MM-DDTHH:MM', () => {
    expect(localStamp(new Date(2026, 10, 13, 9, 5))).toBe('2026-11-13T09:05')
  })
})

describe('古いままの待ちの行', () => {
  const header = 'id\twho\tsection\ttext\twbs\tissue\tnote\torigin\tkey\ttag\tlinks\tbadges\tupdated\n'
  const at = (h: number, m = 0) => new Date(2026, 10, 13, h, m)

  test('tone が wait のバッジの行で、最後に直してから 3 時間以上たったものに印が付く（既定 3 時間）', async () => {
    await put(`.tadori/daily/${day}.tsv`, header
      + 'm1\tA\ttoday\t上長に確認\t\t\t\tmanual\t\t\t\twait 確認中\t2026-11-13T10:12\n'
      + 'm2\tA\ttoday\t回答あり\t\t\t\tmanual\t\t\t\twait 確認中\t2026-11-13T15:00\n'
      + 'm3\tA\ttoday\t画面の設計\t\t\t\tmanual\t\t\t\thole 遅延\t2026-11-13T09:00\n'
      + 'm4\tA\ttoday\t前の版の行\t\t\t\tmanual\t\t\t\twait 確認中\t\n')
    const daily = await loadDaily(dir, day, undefined, { now: at(16, 0) })
    // m2 はまだ新しい・m3 は待ちではない・m4 は時刻が無いので古さが分からない
    expect(daily.stale).toEqual({ ids: ['m1'], hours: 3 })
  })

  test('案件の wait_words を本文に含む行も待ちと読み、stale_hours で時間を変えられる。0 なら出さない', async () => {
    await put(`.tadori/daily/${day}.tsv`, header + 'm1\tA\ttoday\t上長に確認中\t\t\t\tmanual\t\t\t\t\t2026-11-13T15:00\n')
    expect((await loadDaily(dir, day, undefined, { now: at(16, 0) })).stale.ids).toEqual([])
    await put('.tadori/daily-format.tsv', 'key\tvalue\nwait_words\t確認中・回答待ち\nstale_hours\t1\n')
    expect((await loadDaily(dir, day, undefined, { now: at(16, 0) })).stale).toEqual({ ids: ['m1'], hours: 1 })
    await put('.tadori/daily-format.tsv', 'key\tvalue\nwait_words\t確認中\nstale_hours\t0\n')
    expect((await loadDaily(dir, day, undefined, { now: at(23, 0) })).stale.ids).toEqual([])
    await rm(join(dir, '.tadori/daily-format.tsv'))
  })

  test('直すと時刻が新しくなり、印が外れる', async () => {
    await put(`.tadori/daily/${day}.tsv`, header + 'm1\tA\ttoday\t上長に確認\t\t\t\tmanual\t\t\t\twait 確認中\t2026-01-01T10:00\n')
    expect((await loadDaily(dir, day)).stale.ids).toEqual(['m1'])
    await updateDaily(dir, day, 'm1', { badges: [{ text: '回答あり', tone: 'ok' }] })
    expect((await loadDaily(dir, day)).stale.ids).toEqual([])
  })
})
