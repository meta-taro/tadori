import { afterAll, beforeEach, describe, expect, test } from 'vitest'
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { loadProject } from '../src/infrastructure/repository.js'
import { removeItem, removeMember, removeRule, saveItem, saveMember, saveRule, saveTask, WriteRefused } from '../src/infrastructure/project-writer.js'

// 架空の見本の案件を写して使う
const EXAMPLE = resolve(import.meta.dirname, '../../../examples/lend-v12')
const made: string[] = []
let dir = ''
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tadori-write-'))
  made.push(dir)
  await cp(EXAMPLE, dir, { recursive: true })
})
afterAll(async () => { for (const d of made) await rm(d, { recursive: true, force: true }) })

describe('台帳の行（saveItem・removeItem）', () => {
  test('足す・直す。refs は台帳にある ID だけ', async () => {
    await saveItem(dir, { id: 'RUN-0013', kind: 'RUN', title: 'TC-07 の実施', source: 'runs/RUN-0013/run.json', refs: ['TC-07'] }, { create: true })
    expect((await loadProject(dir)).items.find(i => i.id === 'RUN-0013')?.refs).toEqual(['TC-07'])
    await saveItem(dir, { id: 'DD-2.3', fields: { change: '変わる' } }, { create: false })
    expect((await loadProject(dir)).items.find(i => i.id === 'DD-2.3')?.fields.change).toBe('変わる')
  })

  test('無い ID を refs に書く・同じ ID を足す・無い行を直す、は断り、ファイルを元のままにする', async () => {
    const before = await readFile(join(dir, 'ledger/items.tsv'), 'utf8')
    await expect(saveItem(dir, { id: 'X-1', kind: 'X', title: 'x', refs: ['NOPE-9'] }, { create: true })).rejects.toThrow(WriteRefused)
    await expect(saveItem(dir, { id: 'DD-2.3', kind: 'DD', title: 'x' }, { create: true })).rejects.toThrow(/もうあります/)
    await expect(saveItem(dir, { id: 'ZZ-1', title: 'x' }, { create: false })).rejects.toThrow(/ありません/)
    expect(await readFile(join(dir, 'ledger/items.tsv'), 'utf8')).toBe(before)
  })

  test('ほかの行が refs に書いている行は消さない（つながりが切れるため）', async () => {
    await expect(removeItem(dir, 'TC-07')).rejects.toThrow(/F-02/)
    await removeItem(dir, 'F-02')
    expect((await loadProject(dir)).items.some(i => i.id === 'F-02')).toBe(false)
  })
})

describe('WBS の作業（saveTask）', () => {
  test('状態・日付・担当を変える。設定に無い状態や、おかしな日付は断る', async () => {
    await saveTask(dir, { id: 'W-09', status: 'doing', end: '2026-11-26', owner: '検証担当' }, { create: false })
    const task = (await loadProject(dir)).tasks.find(t => t.id === 'W-09')
    expect(task).toMatchObject({ status: 'doing', end: '2026-11-26', owner: '検証担当' })
    await expect(saveTask(dir, { id: 'W-09', status: 'nope' }, { create: false })).rejects.toThrow(/状態/)
    await expect(saveTask(dir, { id: 'W-09', end: '11/26' }, { create: false })).rejects.toThrow(WriteRefused)
  })
})

describe('ルール（saveRule・removeRule）', () => {
  test('足すと rules.tsv に入り、直すと元のファイルのまま直る。知らない判定は断る', async () => {
    await saveRule(dir, { id: 'R20', phase: 'it', kind: 'covered', from: 'TC', to: 'RUN', label: '試験ケースに実施がある', owner: '検証担当' }, { create: true })
    expect((await loadProject(dir)).rules.find(r => r.id === 'R20')).toMatchObject({ phase: 'it', kind: 'covered', owner: '検証担当' })
    await saveRule(dir, { id: 'R9', owner: '開発担当' }, { create: false })
    expect(await readFile(join(dir, '.tadori/rulesets/integration-test.tsv'), 'utf8')).toMatch(/R9\t.*開発担当/)
    await expect(saveRule(dir, { id: 'R21', phase: 'it', kind: 'nope', label: 'x' }, { create: true })).rejects.toThrow(WriteRefused)
    await removeRule(dir, 'R20')
    expect((await loadProject(dir)).rules.some(r => r.id === 'R20')).toBe(false)
  })
})

describe('人の表（saveMember・removeMember）', () => {
  test('足す・直す・消す。表が無ければ作る', async () => {
    await saveMember(dir, { name: '検証担当B', git: 'kensho-b', roles: ['検証担当'] })
    await saveMember(dir, { name: '検証担当B', roles: ['検証担当', 'PM'] })
    expect(await readFile(join(dir, '.tadori/members.tsv'), 'utf8')).toContain('検証担当B\tkensho-b\t検証担当・PM')
    await removeMember(dir, '検証担当B')
    expect(await readFile(join(dir, '.tadori/members.tsv'), 'utf8')).not.toContain('検証担当B')
  })
})
