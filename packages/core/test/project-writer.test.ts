import { afterAll, beforeEach, describe, expect, test } from 'vitest'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { loadProject } from '../src/infrastructure/repository.js'
import { trace } from '../src/usecase/trace.js'
import { addLesson, removeItem, removeMember, removeRule, saveItem, saveMember, saveRule, saveTask, WriteRefused } from '../src/infrastructure/project-writer.js'

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
  test('検証シートや WBS から読んだ行は、台帳に書き写さず、直す・消すを断る（その場所で直す）', async () => {
    await writeFile(join(dir, 'qa-sheet.tsv'), '#! md-business:test-spec-tsv/v1\nケースID\t項目\t_id\nTC-90\t見本\tr00000000000a\n', 'utf8')
    await writeFile(join(dir, '.tadori/sheets.tsv'), 'path\tkind\tid\ttitle\nqa-sheet.tsv\tTC\tケースID\t項目\n', 'utf8')
    const before = await readFile(join(dir, 'ledger/items.tsv'), 'utf8')
    await expect(saveItem(dir, { id: 'TC-90', title: 'x' }, { create: false })).rejects.toThrow(/qa-sheet\.tsv/)
    await expect(removeItem(dir, 'TC-90')).rejects.toThrow(/qa-sheet\.tsv/)
    const task = (await loadProject(dir)).tasks[0]?.id as string
    await expect(saveItem(dir, { id: task, title: 'x' }, { create: false })).rejects.toThrow(/wbs\.tsv/)
    expect(await readFile(join(dir, 'ledger/items.tsv'), 'utf8')).toBe(before)
  })

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

describe('正本から手元へ反映した日時（saveItem の synced）', () => {
  test('synced を渡すと、その行の synced_at・synced_by を書く（列が無ければ足す）', async () => {
    await saveItem(dir, { id: 'DD-2.3', fields: { change: '変わる' } }, { create: false, synced: { at: '2026-11-09 15:20', who: '設計担当' } })
    const item = (await loadProject(dir)).items.find(i => i.id === 'DD-2.3')
    expect(item?.fields).toMatchObject({ change: '変わる', synced_at: '2026-11-09 15:20', synced_by: '設計担当' })
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
  test('範囲が local の分類のルールは、git に入れないファイル（rules.local.tsv）に書き、commit しない', async () => {
    await writeFile(join(dir, '.tadori/rule-groups.tsv'), 'id\tname\torder\tcolor\tscope\nmine\t自分との約束\t1\t\tlocal\n', 'utf8')
    const result = await saveRule(dir, { id: 'L91', kind: 'note', group: 'mine', label: '自分の約束' }, { create: true })
    expect(result.committed).toBe(false)
    expect(await readFile(join(dir, '.tadori/rulesets/rules.local.tsv'), 'utf8')).toContain('L91')
    expect(await readFile(join(dir, '.tadori/rulesets/.gitignore'), 'utf8')).toContain('*.local.tsv')
    expect(await readFile(join(dir, '.tadori/rulesets/rules.tsv'), 'utf8').catch(() => '')).not.toContain('L91')
    await removeRule(dir, 'L91')
  })

  test('判定しない文のルール（note）は工程なしで足せ、分類（group）も書ける。判定のルールは工程が要る', async () => {
    await saveRule(dir, { id: 'N91', kind: 'note', group: 'visible', label: '朝会のカンペは結論を先に書く' }, { create: true })
    expect((await loadProject(dir)).rules.find(r => r.id === 'N91')).toMatchObject({ kind: 'note', phase: '', group: 'visible' })
    await saveRule(dir, { id: 'N91', group: '' }, { create: false })
    expect((await loadProject(dir)).rules.find(r => r.id === 'N91')).not.toHaveProperty('group')
    await expect(saveRule(dir, { id: 'N92', kind: 'covered', from: 'TC', to: 'RUN', label: 'x' }, { create: true })).rejects.toThrow(WriteRefused)
    await removeRule(dir, 'N91')
  })

  test('値で判定するルール（allowed と values、only の「!=」「a|b」）を足して読み戻せる。values の無い allowed は断る', async () => {
    await saveRule(dir, { id: 'R30', phase: 'it', kind: 'allowed', from: 'RUN', field: 'result', values: 'OK|NG', only: 'env!=local|dev', label: '結果は OK か NG' }, { create: true })
    expect((await loadProject(dir)).rules.find(r => r.id === 'R30')).toMatchObject({ kind: 'allowed', values: ['OK', 'NG'], only: { field: 'env', value: 'local|dev', values: ['local', 'dev'], negate: true } })
    await expect(saveRule(dir, { id: 'R31', phase: 'it', kind: 'allowed', from: 'RUN', field: 'result', label: 'x' }, { create: true })).rejects.toThrow(WriteRefused)
    await removeRule(dir, 'R30')
  })

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

describe('失敗からルールを育てる（addLesson）', () => {
  test('失敗の記録（台帳の行）・節目の約束（note ルール）・書いてはいけない語（forbidden ルール）を 1 回で足し、ルールから失敗へ辿れる', async () => {
    await addLesson(dir, {
      failure: { id: 'FL-1', title: '期待結果に関数名を書いて、確かめる人が読めなかった', refs: ['TC-04'] },
      rule: { id: 'N90', label: '期待結果は画面で見える言葉で書く', at: 'cases-written', check: '期待結果に関数名や実装の語が無いか' },
      pattern: { id: 'V90', phase: 'it', from: 'TC', field: 'title', words: 'saveLoan|colspan' },
    })
    const project = await loadProject(dir)
    expect(project.items.find(i => i.id === 'FL-1')).toMatchObject({ kind: 'FL', refs: ['TC-04'] })
    expect(project.rules.find(r => r.id === 'N90')).toMatchObject({ kind: 'note', source: 'FL-1', at: ['cases-written'], check: '期待結果に関数名や実装の語が無いか' })
    expect(project.rules.find(r => r.id === 'V90')).toMatchObject({ kind: 'forbidden', source: 'FL-1', field: 'title', values: ['saveLoan', 'colspan'] })
    expect(trace(project, 'FL-1')?.lessons.map(r => r.id)).toEqual(['N90', 'V90'])
  })

  test('ID が使われている・refs が台帳に無い・節目が無いときは断り、何も書かない', async () => {
    const before = await readFile(join(dir, 'ledger/items.tsv'), 'utf8')
    const base = { failure: { id: 'FL-2', title: '失敗' }, rule: { id: 'N91', label: '約束', at: 'cases-written' } }
    await expect(addLesson(dir, { ...base, failure: { ...base.failure, refs: ['NOPE-1'] } })).rejects.toThrow(WriteRefused)
    await expect(addLesson(dir, { ...base, rule: { ...base.rule, at: '' } })).rejects.toThrow(WriteRefused)
    await expect(addLesson(dir, { ...base, rule: { ...base.rule, at: 'before-lunch' } })).rejects.toThrow(WriteRefused)
    await expect(addLesson(dir, { ...base, failure: { ...base.failure, id: 'TC-04' } })).rejects.toThrow(WriteRefused)
    expect(await readFile(join(dir, 'ledger/items.tsv'), 'utf8')).toBe(before)
    expect((await loadProject(dir)).rules.some(r => r.id === 'N91')).toBe(false)
  })
})

describe('ルールの生まれた元（source）', () => {
  test('台帳にある行なら source に書けて、空で外せる。台帳に無い ID は断る', async () => {
    await saveRule(dir, { id: 'N93', kind: 'note', label: '約束', source: 'F-02' }, { create: true })
    expect((await loadProject(dir)).rules.find(r => r.id === 'N93')?.source).toBe('F-02')
    await saveRule(dir, { id: 'N93', source: '' }, { create: false })
    expect((await loadProject(dir)).rules.find(r => r.id === 'N93')).not.toHaveProperty('source')
    await expect(saveRule(dir, { id: 'N93', source: 'FL-99' }, { create: false })).rejects.toThrow(/FL-99/)
  })

  test('source には台帳の行を「|」で複数書ける。台帳に無い ID が 1 つでもあれば断る', async () => {
    await saveRule(dir, { id: 'N94', kind: 'note', label: '束ねた約束', source: 'F-02|TC-04' }, { create: true })
    expect((await loadProject(dir)).rules.find(r => r.id === 'N94')?.source).toBe('F-02|TC-04')
    await expect(saveRule(dir, { id: 'N94', source: 'F-02|FL-98' }, { create: false })).rejects.toThrow(/FL-98/)
  })
})

describe('ルールを束ねる（merged_from）', () => {
  test('束ねる前の ID を書ける。まだルールとして残っている ID・自分の ID は断る', async () => {
    await saveRule(dir, { id: 'N95', kind: 'note', label: '束ねた約束', merged_from: 'N-old1|N-old2' }, { create: true })
    expect((await loadProject(dir)).rules.find(r => r.id === 'N95')?.mergedFrom).toEqual(['N-old1', 'N-old2'])
    await saveRule(dir, { id: 'N94', kind: 'note', label: '残っている約束' }, { create: true })
    await expect(saveRule(dir, { id: 'N95', merged_from: 'N94' }, { create: false })).rejects.toThrow(/N94/)
    await expect(saveRule(dir, { id: 'N95', merged_from: 'N95' }, { create: false })).rejects.toThrow(WriteRefused)
  })
})
