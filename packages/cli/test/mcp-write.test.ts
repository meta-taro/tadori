import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createMcpHandler } from '../src/mcp.js'

const GLOSSARY = resolve(import.meta.dirname, '../../ui/static/glossary.tsv')
const EXAMPLE = resolve(import.meta.dirname, '../../../examples/lend-v12')
type ToolResult = { content: Array<{ type: string; text: string }>; isError?: boolean }

let dir = ''
let other = ''
let handle: ReturnType<typeof createMcpHandler>
const tool = async (name: string, args: Record<string, unknown> = {}) =>
  ((await handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })) as { result: ToolResult }).result

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tadori-mcpw-'))
  other = await mkdtemp(join(tmpdir(), 'tadori-mcpw2-'))
  await cp(EXAMPLE, dir, { recursive: true })
  await cp(EXAMPLE, other, { recursive: true })
  handle = createMcpHandler({ glossaryPath: GLOSSARY, version: '0.0.1', projectDir: dir, today: '2026-11-05' })
})
afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
  await rm(other, { recursive: true, force: true })
})

describe('MCP の書く道具', () => {
  test('人の承認を書く道具は無い（承認するのは人だけ）', async () => {
    const list = (await handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' })) as { result: { tools: Array<{ name: string }> } }
    const names = list.result.tools.map(t => t.name)
    expect(names).toEqual(expect.arrayContaining(['item_add', 'item_update', 'item_remove', 'task_update', 'rule_add', 'member_set', 'phase_set', 'run_check', 'open_project']))
    expect(names.some(n => /approv/i.test(n))).toBe(false)
  })

  test('item_add：台帳に無い ID を refs に書くと断り、ファイルは元のまま', async () => {
    const before = await readFile(join(dir, 'ledger/items.tsv'), 'utf8')
    const result = await tool('item_add', { id: 'RUN-0013', kind: 'RUN', title: 'TC-07 の実施', refs: ['NOPE-1'] })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toMatch(/NOPE-1/)
    expect(await readFile(join(dir, 'ledger/items.tsv'), 'utf8')).toBe(before)
  })

  test('item_add・task_update・rule_add・member_set で書ける', async () => {
    expect((await tool('item_add', { id: 'RUN-0013', kind: 'RUN', title: 'TC-07 の実施', source: 'runs/RUN-0013/run.json', refs: ['TC-07'] })).isError).toBeUndefined()
    expect((await tool('task_update', { id: 'W-09', status: 'doing' })).isError).toBeUndefined()
    expect((await tool('rule_add', { id: 'R30', phase: 'it', kind: 'filled', from: 'TC', field: 'verifier', label: '試験ケースに確かめる人がいる' })).isError).toBeUndefined()
    expect((await tool('member_set', { name: '検証担当B', roles: ['検証担当'] })).isError).toBeUndefined()
    expect(await readFile(join(dir, 'ledger/items.tsv'), 'utf8')).toContain('RUN-0013\tRUN\tTC-07 の実施')
    expect(await readFile(join(dir, 'ledger/wbs.tsv'), 'utf8')).toMatch(/W-09\t.*\tdoing/)
  })

  test('正本から反映した記録：item_update に synced_by を付けるか item_synced で、日時とだれがを書く', async () => {
    expect((await tool('item_update', { id: 'DD-2.3', fields: { change: '変わる' }, synced_by: '設計担当' })).isError).toBeUndefined()
    expect((await tool('item_synced', { id: 'F-02', who: '検証担当' })).isError).toBeUndefined()
    const items = await readFile(join(dir, 'ledger/items.tsv'), 'utf8')
    expect(items).toMatch(/DD-2\.3\t.*\d{4}-\d{2}-\d{2} \d{2}:\d{2}\t設計担当/)
    expect(items).toMatch(/F-02\t.*\d{4}-\d{2}-\d{2} \d{2}:\d{2}\t検証担当/)
    expect((await tool('item_synced', { id: 'F-02' })).isError).toBe(true) // だれがは要る
  })

  test('run_check：log を付けるとチェックの記録に足す', async () => {
    const result = await tool('run_check', { log: true, who: 'テストのエージェント', why: '確かめるため' })
    expect(result.content[0]?.text).toContain('チェックの記録を足しました')
    const log = await readFile(join(dir, '.tadori/checks.tsv'), 'utf8')
    expect(log).toContain('テストのエージェント')
    // 場所は案件の中（案件そのものを見たので空）。立ち上げた場所からの相対（..\..）は書かない。判定しない約束（note）は記録しない
    const added = log.trim().split('\n').filter(l => l.includes('テストのエージェント'))
    expect(added.length).toBeGreaterThan(0)
    expect(added.every(l => l.split('\t')[3] === '')).toBe(true)
    expect(added.some(l => /\tN\d+ · /.test(l))).toBe(false)
  })

  test('open_project で開く案件を替えると、以後の道具はその案件を読み書きする', async () => {
    expect((await tool('open_project', { path: join(other, 'ledger') })).isError).toBe(true) // .tadori の無いフォルダ
    expect((await tool('open_project', { path: other })).isError).toBeUndefined()
    await tool('task_update', { id: 'W-10', status: 'doing' })
    expect(await readFile(join(other, 'ledger/wbs.tsv'), 'utf8')).toMatch(/W-10\t.*\tdoing/)
    expect(await readFile(join(dir, 'ledger/wbs.tsv'), 'utf8')).not.toMatch(/W-10\t.*\tdoing/)
    expect((await tool('list_projects')).content[0]?.text).toContain('いま開いている')
  })
})

describe('MCP の 1 日の進行：課題ごとの要約', () => {
  test('daily_add の section に summary があり、daily の read で読み上げの文になる', async () => {
    const list = (await handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' })) as { result: { tools: Array<{ name: string; inputSchema: { properties: Record<string, { enum?: string[] }> } }> } }
    const add = list.result.tools.find(t => t.name === 'daily_add')
    expect(add?.inputSchema.properties.section?.enum).toContain('summary')
    expect(list.result.tools.find(t => t.name === 'daily')?.inputSchema.properties).toHaveProperty('read')

    const date = '2026-11-12'
    await tool('daily_add', { date, who: '設計担当', section: 'today', issue: 'Q-1', text: '問い合わせの回答を下書きした' })
    const added = await tool('daily_add', { date, who: '設計担当', section: 'summary', issue: 'Q-1', text: '回答の下書きまで済みました。今日は終わりません。明日送ります' })
    expect(added.isError).toBeFalsy()
    const read = await tool('daily', { date, read: true })
    expect(read.content[0]?.text).toContain('明日送ります')
    expect(read.content[0]?.text.split('\n\n')[0]).not.toContain('回答を下書きした')
    const detail = await tool('daily', { date })
    expect(detail.content[0]?.text.split('\n\n')[0]).toContain('回答を下書きした')
  })
})
