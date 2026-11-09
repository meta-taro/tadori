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

  test('run_check：log を付けるとチェックの記録に足す', async () => {
    const result = await tool('run_check', { log: true, who: 'テストのエージェント', why: '確かめるため' })
    expect(result.content[0]?.text).toContain('チェックの記録を足しました')
    expect(await readFile(join(dir, '.tadori/checks.tsv'), 'utf8')).toContain('テストのエージェント')
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
