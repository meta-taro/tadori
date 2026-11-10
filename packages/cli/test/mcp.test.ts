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

  test('list_rules：判定しない約束（note）を分類の名前つきで返し、分類と種類で絞れる', async () => {
    const all = (await tool('list_rules')).content.at(0)?.text ?? ''
    expect(all).toContain('- N1［見える化（カンペ・報告の書き方）］note：朝会のカンペは')
    expect(all).toMatch(/- R8［プロダクト向け（工程ごとの判定）］covered · 結合テスト：/)
    const agreements = (await tool('list_rules', { group: 'agreement' })).content.at(0)?.text ?? ''
    expect(agreements.split('\n').map(l => l.slice(2, 4))).toEqual(['N3', 'N4'])
    expect((await tool('list_rules', { kind: 'note' })).content.at(0)?.text).not.toContain('R8')
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

  test('find_items・trace：正本の表にある行は、正本の URL と反映の記録（古ければそう）を添える', async () => {
    const found = (await tool('find_items', { query: 'F-02' })).content.at(0)?.text ?? ''
    expect(found).toContain('正本：https://issues.example.com/lend-v12（反映の記録なし・古い）')
    const traced = (await tool('trace', { id: 'F-02' })).content.at(0)?.text ?? ''
    expect(traced).toContain('正本：https://issues.example.com/lend-v12')
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

describe('MCP の daily（人単位の 1 日の進行）', () => {
  test('担当と日付で、1 日の進行の文を返す', async () => {
    const result = await tool('daily', { date: '2026-11-05', who: '検証担当' })
    expect(result.isError).toBeUndefined()
    expect(result.content[0]?.text).toMatch(/^今日（11\/5 木）/)
    expect(result.content[0]?.text).toContain('相談')
  })

  test('日付の形がおかしければ isError', async () => {
    expect((await tool('daily', { date: 'きょう' })).isError).toBe(true)
  })
})

describe('server_errors（画面の裏の server で起きた例外を読む）', () => {
  test('新しい順に、時刻・API・例外の要点と、落ちた所を返す。無ければそう言う', async () => {
    const { mkdtemp, rm } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { appendServerError } = await import('../src/error-log.js')
    const logDir = await mkdtemp(join(tmpdir(), 'tadori-mcp-log-'))
    const mcp = createMcpHandler({ glossaryPath: GLOSSARY, version: '0.0.1', logDir })
    const call = async (args: Record<string, unknown>) => ((await mcp({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'server_errors', arguments: args } })) as { result: ToolResult }).result
    expect((await call({})).content[0]?.text).toContain('記録はありません')
    await appendServerError(logDir, { method: 'GET', path: '/api/daily', project: 'C:/work/a', error: new TypeError('x is not a function') })
    const text = (await call({ limit: 5 })).content[0]?.text ?? ''
    expect(text).toContain('GET /api/daily')
    expect(text).toContain('TypeError: x is not a function')
    expect(text).toContain(logDir)
    await rm(logDir, { recursive: true, force: true })
  })
})

describe('MCP の version', () => {
  test('版・組んだ commit・組んだ日時を返す（いま動いている MCP がどの版か見分けるため）', async () => {
    const { mkdtemp, rm, writeFile } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const dir = await mkdtemp(join(tmpdir(), 'tadori-build-'))
    try {
      await writeFile(join(dir, 'build-info.json'), JSON.stringify({ builtAt: '2026-11-10T07:30:00.000Z', commit: 'e8acd15' }), 'utf8')
      const h = createMcpHandler({ glossaryPath: GLOSSARY, version: '0.2.2', buildDir: dir, sourceDirs: [] })
      const res = await h({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'version', arguments: {} } }) as { result: ToolResult }
      const text = res.result.content.at(0)?.text ?? ''
      expect(text).toContain('tadori 0.2.2')
      expect(text).toContain('e8acd15')
      expect(text).toContain('2026-11-10T07:30:00.000Z')
      expect(text).not.toContain('組み直')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('元のコードが組んだあとに変わっていれば、組み直してつなぎ直す手順を添える', async () => {
    const { mkdtemp, rm, writeFile } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const dir = await mkdtemp(join(tmpdir(), 'tadori-build-'))
    try {
      await writeFile(join(dir, 'build-info.json'), JSON.stringify({ builtAt: '2000-01-01T00:00:00.000Z', commit: 'old0000' }), 'utf8')
      const h = createMcpHandler({ glossaryPath: GLOSSARY, version: '0.0.1', buildDir: dir, sourceDirs: [resolve(import.meta.dirname, '../src')] })
      const res = await h({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'version', arguments: {} } }) as { result: ToolResult }
      expect(res.result.content.at(0)?.text ?? '').toContain('pnpm build')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('組んだ記録が無ければ、commit は分からないと言う', async () => {
    const h = createMcpHandler({ glossaryPath: GLOSSARY, version: '0.0.1', buildDir: resolve(import.meta.dirname, 'no-such-dir'), sourceDirs: [] })
    const res = await h({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'version', arguments: {} } }) as { result: ToolResult }
    expect(res.result.content.at(0)?.text ?? '').toContain('組んだ commit は分かりません')
  })
})
