import { describe, expect, test } from 'vitest'
import { resolve } from 'node:path'
import { createMcpHandler } from '../src/mcp.js'

const GLOSSARY = resolve(import.meta.dirname, '../../ui/static/glossary.tsv')
const handle = createMcpHandler({ glossaryPath: GLOSSARY, version: '0.0.1' })

const call = (id: number, method: string, params: unknown = {}) => handle({ jsonrpc: '2.0', id, method, params })
type ToolResult = { content: Array<{ type: string; text: string }>; isError?: boolean }

const EXAMPLE = resolve(import.meta.dirname, '../../../examples/lend-v12')
const withProject = createMcpHandler({ glossaryPath: GLOSSARY, version: '0.0.1', projectDir: EXAMPLE, today: '2026-11-05' })
const tool = async (name: string, args: Record<string, unknown> = {}) => {
  const res = await withProject({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) as { result: ToolResult }
  return res.result
}

describe('MCP の読む道具（案件を指定して起動したとき）', () => {
  test('tools/list に残課題・漏れ・つながり・行を探す道具がある', async () => {
    const res = await withProject({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) as { result: { tools: Array<{ name: string }> } }
    expect(res.result.tools.map(t => t.name)).toEqual(expect.arrayContaining(['glossary', 'get_remaining', 'list_leaks', 'trace', 'find_items']))
  })

  test('get_remaining：工程ごとの残課題と、前の完了判定より前に着手を返す。割合は出さない', async () => {
    const text = (await tool('get_remaining')).content.at(0)?.text ?? ''
    expect(text).toMatch(/詳細設計.*基本設計の完了判定より前に着手/)
    expect(text).not.toMatch(/%/)
  })

  test('list_leaks：工程で絞れる', async () => {
    const text = (await tool('list_leaks', { phase: 'dd' })).content.at(0)?.text ?? ''
    expect(text).toContain('R4')
    expect(text).not.toContain('R9')
  })

  test('trace：1 行から辿り、切れ目を返す。無い ID は isError', async () => {
    expect((await tool('trace', { id: 'F-02' })).content.at(0)?.text).toMatch(/✗.*R9/)
    expect((await tool('trace', { id: 'NOPE' })).isError).toBe(true)
  })

  test('find_items：ID か名前で台帳の行を探す', async () => {
    const text = (await tool('find_items', { query: '延滞' })).content.at(0)?.text ?? ''
    expect(text).toContain('TC-07')
  })

  test('案件を指定せずに起動したときは、案件の道具がそう言って断る', async () => {
    const res = await handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_remaining', arguments: {} } }) as { result: ToolResult }
    expect(res.result.isError).toBe(true)
    expect(res.result.content.at(0)?.text).toMatch(/案件のフォルダ/)
  })
})

describe('MCP の口', () => {
  test('initialize に、tadori の名前と道具を持つことを返す', async () => {
    const res = await call(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } })
    expect(res).toMatchObject({ jsonrpc: '2.0', id: 1, result: { serverInfo: { name: 'tadori' }, capabilities: { tools: {} } } })
  })

  test('通知（id の無いもの）には返事をしない', async () => {
    expect(await handle({ jsonrpc: '2.0', method: 'notifications/initialized' })).toBeNull()
  })

  test('tools/list に用語の道具（glossary）がある', async () => {
    const res = await call(2, 'tools/list') as { result: { tools: Array<{ name: string; inputSchema: unknown }> } }
    const tool = res.result.tools.find(t => t.name === 'glossary')
    expect(tool).toBeDefined()
    expect(tool?.inputSchema).toMatchObject({ type: 'object' })
  })

  test('glossary：言葉で引くと、意味と画面のどこに出るかを返す', async () => {
    const res = await call(3, 'tools/call', { name: 'glossary', arguments: { query: '漏れ' } }) as { result: ToolResult }
    const text = res.result.content.at(0)?.text ?? ''
    expect(text).toContain('漏れ')
    expect(text).toContain('ルールが求めるつながりが無い箇所')
  })

  test('glossary：何も渡さなければ全部の言葉をグループごとに返す', async () => {
    const res = await call(4, 'tools/call', { name: 'glossary', arguments: {} }) as { result: ToolResult }
    const text = res.result.content.at(0)?.text ?? ''
    expect(text).toContain('## 全体')
    expect(text).toContain('タスク')
  })

  test('glossary：合う言葉が無ければ、そう言う（エラーにはしない）', async () => {
    const res = await call(5, 'tools/call', { name: 'glossary', arguments: { query: 'まったく無い言葉' } }) as { result: ToolResult }
    expect(res.result.isError).toBeFalsy()
    expect(res.result.content.at(0)?.text).toContain('合う言葉がありません')
  })

  test('知らない道具は isError で返す', async () => {
    const res = await call(6, 'tools/call', { name: 'nope', arguments: {} }) as { result: ToolResult }
    expect(res.result.isError).toBe(true)
  })

  test('知らないメソッドは JSON-RPC のエラー（-32601）', async () => {
    expect(await call(7, 'nope/nope')).toMatchObject({ id: 7, error: { code: -32601 } })
  })
})
