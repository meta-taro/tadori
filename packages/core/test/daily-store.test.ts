import { afterAll, describe, expect, test } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { previousDailyDate, readDaily, readMembers, writeDaily } from '../src/infrastructure/daily-store.js'
import type { DailyEntry } from '../src/usecase/daily-entries.js'

const made: string[] = []
afterAll(async () => { for (const d of made) await rm(d, { recursive: true, force: true }) })
const dirOf = async () => { const d = await mkdtemp(join(tmpdir(), 'tadori-daily-')); made.push(d); return d }

describe('日ごとの「1 日の進行」のファイル', () => {
  test('前の作業日は、その日より前でファイルがいちばん新しい日（休みの日は飛ばす）', async () => {
    const dir = await dirOf()
    expect(await previousDailyDate(dir, '2026-11-09')).toBeUndefined()
    for (const d of ['2026-11-05', '2026-11-06', '2026-11-10']) await writeDaily(dir, d, [], 'x')
    expect(await previousDailyDate(dir, '2026-11-09')).toBe('2026-11-06')
    expect(await previousDailyDate(dir, '2026-11-05')).toBeUndefined()
  })

  test('書いて読むと同じ行に戻る（WBS は複数、文のタブや改行は空白にする）', async () => {
    const dir = await dirOf()
    const entries: DailyEntry[] = [
      { id: 'a1', who: '設計担当', section: 'today', text: '画面の設計\tを直した', wbs: ['W-01', 'W-02'], issue: 'BUG-012', origin: 'edited', key: 'wbs:today:W-01+W-02' },
      { id: 'm1', who: '設計担当・検証担当', section: 'consult', text: '環境の空きを確かめたい', wbs: [], note: '仕様 §3', origin: 'manual' },
    ]
    const commit = await writeDaily(dir, '2026-11-09', entries, '1 日の進行を直した')
    expect(commit.committed).toBe(false) // git の外なので commit しない
    expect(await readFile(join(dir, '.tadori/daily/2026-11-09.tsv'), 'utf8')).toMatch(/^id\twho\tsection\ttext\twbs\tissue\tnote\torigin\tkey\ttag\tlinks\n/)
    const back = await readDaily(dir, '2026-11-09')
    expect(back[0]).toEqual({ ...entries[0], text: '画面の設計 を直した' })
    expect(back[1]).toEqual(entries[1])
  })

  test('行のリンク（表示名と URL）は「表示名 URL | 表示名 URL」の 1 セルに書き、読むと同じ組に戻る', async () => {
    const dir = await dirOf()
    const links = [{ label: 'QA表', url: 'https://sheets.example.com/qa#row=12' }, { label: '設計書 3.2.5', url: 'https://docs.example.com/d?s=3.2.5' }]
    await writeDaily(dir, '2026-11-09', [{ id: 'm1', who: '設計担当', section: 'today', text: 'QA を返した', wbs: [], origin: 'manual', links }], 'x')
    expect(await readFile(join(dir, '.tadori/daily/2026-11-09.tsv'), 'utf8')).toContain('QA表 https://sheets.example.com/qa#row=12 | 設計書 3.2.5 https://docs.example.com/d?s=3.2.5')
    expect((await readDaily(dir, '2026-11-09'))[0]?.links).toEqual(links)
  })

  test('ファイルが無い日は空。おかしな見出し・出どころの行は読み飛ばさず、問題として止める', async () => {
    const dir = await dirOf()
    expect(await readDaily(dir, '2026-11-10')).toEqual([])
    await mkdir(join(dir, '.tadori/daily'), { recursive: true })
    await writeFile(join(dir, '.tadori/daily/2026-11-11.tsv'), 'id\twho\tsection\ttext\twbs\tissue\tnote\torigin\tkey\nx\ta\tnope\tt\t\t\t\tauto\t\n', 'utf8')
    await expect(readDaily(dir, '2026-11-11')).rejects.toThrow(/section/)
  })

  test('担当と git の名前の表は、無ければ空', async () => {
    const dir = await dirOf()
    expect(await readMembers(dir)).toEqual([])
    await mkdir(join(dir, '.tadori'), { recursive: true })
    await writeFile(join(dir, '.tadori/members.tsv'), 'name\tgit\n設計担当\tsekkei-dev\n', 'utf8')
    expect(await readMembers(dir)).toEqual([{ name: '設計担当', git: 'sekkei-dev', roles: [] }])
  })
})

describe('日ごとのファイルの印', () => {
  test('印（tag）も書いて読める', async () => {
    const dir = await dirOf()
    const entries: DailyEntry[] = [{ id: 'a1', who: 'x', section: 'today', text: 't', wbs: [], tag: 'done', origin: 'auto' }]
    await writeDaily(dir, '2026-11-09', entries, 'm')
    expect((await readDaily(dir, '2026-11-09'))[0]?.tag).toBe('done')
  })
})

describe('行のリンクの語（anchor）', () => {
  test('anchor と何番目か（nth）も書いて読める。書き方は「表示名 URL > 語 #番目」', async () => {
    const dir = await dirOf()
    const links = [{ label: 'QA表', url: 'https://sheets.example.com/qa', anchor: 'QA の返事', nth: 2 }, { label: 'MR', url: 'https://git.example.com/mr/3', anchor: 'MR' }, { label: '設計書', url: 'https://docs.example.com/d' }]
    await writeDaily(dir, '2026-11-09', [{ id: 'm1', who: '設計担当', section: 'today', text: 'x', wbs: [], origin: 'manual', links }], 'x')
    expect(await readFile(join(dir, '.tadori/daily/2026-11-09.tsv'), 'utf8')).toContain('QA表 https://sheets.example.com/qa > QA の返事 #2 | MR https://git.example.com/mr/3 > MR | 設計書 https://docs.example.com/d')
    expect((await readDaily(dir, '2026-11-09'))[0]?.links).toEqual(links)
  })
})
