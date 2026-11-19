import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { execFile } from 'node:child_process'
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { verifyCheckpoint } from '../src/checkpoint.js'
import { createMcpHandler } from '../src/mcp.js'

const run = promisify(execFile)
const GLOSSARY = resolve(import.meta.dirname, '../../ui/static/glossary.tsv')
const EXAMPLE = resolve(import.meta.dirname, '../../../examples/lend-v12')
type ToolResult = { content: Array<{ type: string; text: string }>; isError?: boolean }

let dir = ''
let handle: ReturnType<typeof createMcpHandler>
const tool = async (name: string, args: Record<string, unknown> = {}) =>
  ((await handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })) as { result: ToolResult }).result
const textOf = (r: ToolResult) => r.content[0]?.text ?? ''

// 見本の案件を git のリポジトリにして、書くときの約束（note）に節目を付けてから確かめる
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tadori-checkpoint-cli-'))
  await cp(EXAMPLE, dir, { recursive: true })
  await run('git', ['init', '-q'], { cwd: dir })
  await run('git', ['config', 'user.email', 'test@example.invalid'], { cwd: dir })
  await run('git', ['config', 'user.name', 'test'], { cwd: dir })
  await run('git', ['add', '.'], { cwd: dir })
  await run('git', ['commit', '-q', '-m', 'init'], { cwd: dir })
  handle = createMcpHandler({ glossaryPath: GLOSSARY, version: '0.0.1', projectDir: dir, today: '2026-11-12' })
})
afterAll(async () => { await rm(dir, { recursive: true, force: true }) })

describe('節目のチェック（MCP）', () => {
  test('道具がある。rule_update で note に節目と項目を付けられる', async () => {
    const list = (await handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' })) as { result: { tools: Array<{ name: string }> } }
    expect(list.result.tools.map(t => t.name)).toEqual(expect.arrayContaining(['checkpoint', 'checkpoint_record']))
    expect((await tool('rule_update', { id: 'N1', at: 'cases-written|before-commit', check: '期待する結果に作りを書いていないか' })).isError).toBeFalsy()
    expect((await tool('rule_update', { id: 'N2', at: 'cases-written', check: '' })).isError).toBeFalsy()
  })

  test('at を渡さなければ、節目の一覧と、それぞれに効くルールの数', async () => {
    const body = textOf(await tool('checkpoint'))
    expect(body).toMatch(/cases-written.*試験ケースを書き終えた.*2/)
    expect(body).toMatch(/before-post.*0/)
  })

  test('at を渡すと、その節目の項目だけを突きつける（check が無いルールは label）', async () => {
    const body = textOf(await tool('checkpoint', { at: 'cases-written', target: 'TC-04' }))
    expect(body).toContain('N1')
    expect(body).toContain('期待する結果に作りを書いていないか')
    expect(body).toContain('遅れは日数で書き')
    expect(body).toMatch(/まだ記録がありません/)
  })

  test('項目が欠けた記録は断り、何が欠けたかを返す', async () => {
    const result = await tool('checkpoint_record', { at: 'cases-written', target: 'TC-04', who: 'エージェント', answers: [{ rule: 'N1', result: 'ok', where: 'ledger/items.tsv:5' }] })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toMatch(/N2/)
  })

  test('すべての項目に結果と場所があれば記録し、まとめの 1 文を返す。そのあとは通る', async () => {
    const result = await tool('checkpoint_record', { at: 'cases-written', target: 'TC-04', who: 'エージェント', answers: [
      { rule: 'N1', result: 'ok', where: 'ledger/items.tsv:5' },
      { rule: 'N2', result: 'na', where: '試験ケースに遅れの記述は無い' },
    ] })
    expect(result.isError).toBeFalsy()
    expect(textOf(result)).toMatch(/該当ルール 2 件すべて OK/)
    expect(textOf(await tool('checkpoint', { at: 'cases-written', target: 'TC-04' }))).toMatch(/すべて当てた記録があります/)
    expect((await verifyCheckpoint(dir, { at: 'cases-written', target: 'TC-04' })).ok).toBe(true)
    expect((await verifyCheckpoint(dir, { at: 'cases-written', target: 'TC-07' })).ok).toBe(false)
  })
})

describe('コミット前の確かめ（tadori checkpoint verify）', () => {
  test('stage が空なら通る（記録のファイルだけの commit で止まらない）', async () => {
    expect((await verifyCheckpoint(dir, { at: 'before-commit' })).ok).toBe(true)
  })

  test('記録の無い変更は止める。記録すれば通り、記録のあとに中身を替えたら また止める', async () => {
    await writeFile(join(dir, 'note.txt'), 'one\n')
    await run('git', ['add', 'note.txt'], { cwd: dir })
    const before = await verifyCheckpoint(dir, { at: 'before-commit' })
    expect(before.ok).toBe(false)
    expect(before.text).toMatch(/N1/)

    const recorded = await tool('checkpoint_record', { at: 'before-commit', who: 'エージェント', answers: [{ rule: 'N1', result: 'ok', where: 'note.txt:1' }] })
    expect(recorded.isError).toBeFalsy()
    expect((await verifyCheckpoint(dir, { at: 'before-commit' })).ok).toBe(true)

    await writeFile(join(dir, 'note.txt'), 'two\n')
    await run('git', ['add', 'note.txt'], { cwd: dir })
    expect((await verifyCheckpoint(dir, { at: 'before-commit' })).ok).toBe(false)
  })
})

describe('節目の項目に、ミスの回数と元の事例を添える', () => {
  test('失敗から生まれたルールには元の事例の題（と refs の行）を、ミスを見つけたルールには回数と最後の日を出す', async () => {
    // 失敗の行を 2 つ足し、N1 をそこから生まれ、古いルール N-old を束ねたものにする
    expect((await tool('item_add', { id: 'FL-A1', kind: 'FL', title: '画面で押せない操作を URL 直で試して「できる」と書いた', refs: ['TC-04'] })).isError).toBeFalsy()
    expect((await tool('item_add', { id: 'FL-A2', kind: 'FL', title: '本物と違うデータの状態で試して「起きる」と書いた' })).isError).toBeFalsy()
    expect((await tool('rule_update', { id: 'N1', source: 'FL-A1|FL-A2', merged_from: 'N-old' })).isError).toBeFalsy()
    // 古いルールの分と N1 の分で、ミスを 1 回ずつ記録したことにする
    const header = 'run\twhen\twho\tat\ttarget\truleset\trule\tresult\twhere\tnote'
    await writeFile(join(dir, '.tadori/checkpoint-log.tsv'), [header,
      'r1\t2026-11-05 10:00\tA\tcases-written\tTC-07\tv\tN-old\tfixed\tx\t直した',
      'r2\t2026-11-10 10:00\tA\tcases-written\tTC-07\tv\tN1\topen\tx\tまだ',
      ''].join('\n'), 'utf8')
    const body = textOf(await tool('checkpoint', { at: 'cases-written' }))
    expect(body).toContain('- N1【この 30 日で 2 回ミス・最後 2026-11-10（N-old を含む）】: 期待する結果に作りを書いていないか')
    expect(body).toContain('過去の事例：FL-A1 画面で押せない操作を URL 直で試して「できる」と書いた')
    expect(body).toMatch(/関係する行：TC-04 /)
    expect(body).toContain('過去の事例：FL-A2 本物と違うデータの状態で試して「起きる」と書いた')
    // ミスも元の事例も無いルールには何も足さない
    expect(body).toMatch(/^- N2: /m)
  })
})
