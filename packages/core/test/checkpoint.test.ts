import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { loadProject, ProjectLoadError } from '../src/infrastructure/repository.js'
import { appendCheckpoint, CHECKPOINT_LOG, readCheckpointLog, stagedDigest } from '../src/infrastructure/checkpoint-log.js'
import { checklistOf, checkpointsOf, coverageOf, refusalsOf } from '../src/usecase/checkpoint.js'

const run = promisify(execFile)

// 架空の最小の案件。書くときの約束（note）に、効く節目（at）と突きつける項目（check）を書く
const RULES = [
  'id\tphase\tkind\tfrom\tto\tfield\tat\tcheck\tlabel',
  'N-1\t\tnote\t\t\t\tcases-written|before-judge\t期待する結果に作り（関数名・ファイル名）を書いていないか\t試験はブラックボックスで書く',
  'N-2\t\tnote\t\t\t\tbefore-post\t\t確かめられることを確かめてから外へ出す',
  'N-3\t\tnote\t\t\t\t\t\t節目の無い約束',
].join('\n')

let dir = ''
async function put(path: string, text: string): Promise<void> {
  await mkdir(join(dir, path, '..'), { recursive: true })
  await writeFile(join(dir, path), text, 'utf8')
}
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tadori-checkpoint-'))
  await put('.tadori/project.tsv', 'name\n架空の案件\n')
  await put('.tadori/phases.tsv', 'id\tname\torder\nbd\t基本設計\t1\n')
  await put('.tadori/statuses.tsv', 'id\tname\ttone\ntodo\t未着手\tnone\n')
  await put('.tadori/rulesets/rules.tsv', `${RULES}\n`)
  await put('ledger/items.tsv', 'id\tkind\ttitle\tsource\trefs\nTC-1\tTC\t貸出の上限\t\t\n')
  await run('git', ['init', '-q'], { cwd: dir })
  await run('git', ['config', 'user.email', 'test@example.invalid'], { cwd: dir })
  await run('git', ['config', 'user.name', 'test'], { cwd: dir })
  await run('git', ['add', '.'], { cwd: dir })
  await run('git', ['commit', '-q', '-m', 'init'], { cwd: dir })
})
afterAll(async () => { await rm(dir, { recursive: true, force: true }) })

describe('節目（at）と項目（check）', () => {
  test('ルールの at は | で分けて読み、check はそのまま読む', async () => {
    const project = await loadProject(dir)
    const n1 = project.rules.find(r => r.id === 'N-1')
    expect(n1?.at).toEqual(['cases-written', 'before-judge'])
    expect(n1?.check).toContain('関数名')
    expect(project.rules.find(r => r.id === 'N-3')?.at).toBeUndefined()
  })

  test('知らない節目を書いたら、読み込みの問題として止める（黙って効かなくならない）', async () => {
    const other = await mkdtemp(join(tmpdir(), 'tadori-checkpoint-bad-'))
    try {
      await mkdir(join(other, '.tadori/rulesets'), { recursive: true })
      await mkdir(join(other, 'ledger'), { recursive: true })
      await writeFile(join(other, '.tadori/project.tsv'), 'name\nx\n')
      await writeFile(join(other, '.tadori/phases.tsv'), 'id\tname\torder\nbd\tb\t1\n')
      await writeFile(join(other, '.tadori/statuses.tsv'), 'id\tname\ttone\ntodo\tt\tnone\n')
      await writeFile(join(other, 'ledger/items.tsv'), 'id\tkind\ttitle\n')
      await writeFile(join(other, '.tadori/rulesets/rules.tsv'), 'id\tphase\tkind\tat\tlabel\nN-9\t\tnote\tbefore-lunch\tx\n')
      await expect(loadProject(other)).rejects.toThrow(ProjectLoadError)
      await expect(loadProject(other)).rejects.toThrow(/before-lunch/)
    } finally {
      await rm(other, { recursive: true, force: true })
    }
  })

  test('案件が .tadori/checkpoints.tsv で節目を足せる（書かなければ既定の 4 つ）', async () => {
    const project = await loadProject(dir)
    expect(checkpointsOf(project).map(c => c.id)).toEqual(['cases-written', 'before-judge', 'before-post', 'before-commit'])
  })

  test('節目の一覧は、その節目に効くルールだけ。check が無ければ label を項目にする', async () => {
    const project = await loadProject(dir)
    expect(checklistOf(project.rules, 'before-judge').map(c => c.rule)).toEqual(['N-1'])
    const post = checklistOf(project.rules, 'before-post')
    expect(post).toEqual([{ rule: 'N-2', check: '確かめられることを確かめてから外へ出す' }])
    expect(checklistOf(project.rules, 'before-commit')).toEqual([])
  })
})

describe('記録を断る', () => {
  test('項目が欠けている・根拠の場所が空・結果の値が違う・知らないルール、をまとめて返す', async () => {
    const project = await loadProject(dir)
    const problems = refusalsOf(project.rules, 'cases-written', [
      { rule: 'N-2', result: 'ok', where: 'a.tsv:1' },
      { rule: 'N-1', result: 'maybe', where: '' },
    ])
    expect(problems.join('\n')).toMatch(/N-2/)
    expect(problems.join('\n')).toMatch(/maybe/)
    expect(problems.join('\n')).toMatch(/場所/)
  })

  test('ミス（fixed・open）には、何が抜けていて何をしたかを note に書かせる', async () => {
    const project = await loadProject(dir)
    expect(refusalsOf(project.rules, 'cases-written', [{ rule: 'N-1', result: 'fixed', where: 'ledger/items.tsv:2' }]).join('\n')).toMatch(/note/)
    expect(refusalsOf(project.rules, 'cases-written', [{ rule: 'N-1', result: 'open', where: 'ledger/items.tsv:2', note: '期待結果に関数名。まだ直していない' }])).toEqual([])
  })

  test('全部の項目に結果と場所があれば断らない', async () => {
    const project = await loadProject(dir)
    expect(refusalsOf(project.rules, 'cases-written', [{ rule: 'N-1', result: 'na', where: '試験ケースに期待結果の列が無い' }])).toEqual([])
  })
})

describe('記録と、通ったかの確かめ', () => {
  test('記録は追記だけで残り、同じ節目・同じ対象の最後の記録で確かめる', async () => {
    const before = await loadProject(dir)
    expect(coverageOf(before.rules, 'cases-written', 'TC-1', await readCheckpointLog(dir))).toEqual({ recorded: false, missing: ['N-1'], open: [] })
    const result = await appendCheckpoint(dir, { at: 'cases-written', target: 'TC-1', who: 'エージェント', answers: [{ rule: 'N-1', result: 'ok', where: 'ledger/items.tsv:2' }] })
    expect(result.commit.committed).toBe(true)
    const log = await readCheckpointLog(dir)
    // 項目ごとの行と、まとめの行（当てたルールの一覧と 1 文）
    expect(log).toHaveLength(2)
    expect(log[1]).toMatchObject({ rule: '*', result: 'clear', note: 'N-1' })
    expect(log[1]?.where).toMatch(/cases-written/)
    expect(log[0]?.ruleset).toMatch(/^[0-9a-f]{7,}/)
    expect(log[0]).toMatchObject({ at: 'cases-written', target: 'TC-1', rule: 'N-1', result: 'ok', where: 'ledger/items.tsv:2' })
    expect(coverageOf(before.rules, 'cases-written', 'TC-1', log)).toEqual({ recorded: true, missing: [], open: [] })
    // 別の対象は、まだ確かめていない
    expect(coverageOf(before.rules, 'cases-written', 'TC-2', log).recorded).toBe(false)
  })

  test('節目に効くルールが増えたら、前の記録では通らない（チェックが積み上がる）', async () => {
    const project = await loadProject(dir)
    const log = await readCheckpointLog(dir)
    const grown = [...project.rules, { ...project.rules[0]!, id: 'N-4', check: '新しい項目' }]
    expect(coverageOf(grown, 'cases-written', 'TC-1', log)).toEqual({ recorded: true, missing: ['N-4'], open: [] })
  })

  test('項目が欠けた記録は書かない（ファイルは元のまま）', async () => {
    await expect(appendCheckpoint(dir, { at: 'before-post', target: 'draft', who: 'x', answers: [] })).rejects.toThrow(/N-2/)
    expect(await readCheckpointLog(dir)).toHaveLength(2)
  })

  test('記録のファイルの名前', () => {
    expect(CHECKPOINT_LOG).toBe('.tadori/checkpoint-log.tsv')
  })
})

describe('コミット前の対象（いま stage してある変更）', () => {
  test('stage の中身が同じなら同じ印、変われば違う印。記録のファイルの変更は数えない', async () => {
    await writeFile(join(dir, 'a.txt'), 'one\n')
    await run('git', ['add', 'a.txt'], { cwd: dir })
    const first = await stagedDigest(dir)
    await writeFile(join(dir, CHECKPOINT_LOG), 'changed\n', { flag: 'a' })
    await run('git', ['add', CHECKPOINT_LOG], { cwd: dir })
    expect(await stagedDigest(dir)).toBe(first)
    await writeFile(join(dir, 'a.txt'), 'two\n')
    await run('git', ['add', 'a.txt'], { cwd: dir })
    expect(await stagedDigest(dir)).not.toBe(first)
  })

  test('stage が空（記録のファイルだけ）なら null', async () => {
    await run('git', ['reset', '-q', '--', 'a.txt'], { cwd: dir })
    expect(await stagedDigest(dir)).toBeNull()
  })
})
