import { afterAll, describe, expect, test } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readDaily, readMembers, writeDaily } from '../src/infrastructure/daily-store.js'
import type { DailyEntry } from '../src/usecase/daily-entries.js'

const made: string[] = []
afterAll(async () => { for (const d of made) await rm(d, { recursive: true, force: true }) })
const dirOf = async () => { const d = await mkdtemp(join(tmpdir(), 'tadori-daily-')); made.push(d); return d }

describe('日ごとの「1 日の進行」のファイル', () => {
  test('書いて読むと同じ行に戻る（WBS は複数、文のタブや改行は空白にする）', async () => {
    const dir = await dirOf()
    const entries: DailyEntry[] = [
      { id: 'a1', who: '設計担当', section: 'today', text: '画面の設計\tを直した', wbs: ['W-01', 'W-02'], issue: 'BUG-012', origin: 'edited', key: 'wbs:today:W-01+W-02' },
      { id: 'm1', who: '設計担当・検証担当', section: 'consult', text: '環境の空きを確かめたい', wbs: [], note: '仕様 §3', origin: 'manual' },
    ]
    const commit = await writeDaily(dir, '2026-11-09', entries, '1 日の進行を直した')
    expect(commit.committed).toBe(false) // git の外なので commit しない
    expect(await readFile(join(dir, '.tadori/daily/2026-11-09.tsv'), 'utf8')).toMatch(/^id\twho\tsection\ttext\twbs\tissue\tnote\torigin\tkey\n/)
    const back = await readDaily(dir, '2026-11-09')
    expect(back[0]).toEqual({ ...entries[0], text: '画面の設計 を直した' })
    expect(back[1]).toEqual(entries[1])
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
    expect(await readMembers(dir)).toEqual([{ name: '設計担当', git: 'sekkei-dev' }])
  })
})
