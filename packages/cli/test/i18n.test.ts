import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { resolve } from 'node:path'
import type { AddressInfo } from 'node:net'
import type { IncomingMessage } from 'node:http'
import { withLang } from '@tadori/core'
import { requestLang, startServer, type RunningServer } from '../src/server.js'
import { formatCheck } from '../src/format.js'
import { createMcpHandler } from '../src/mcp.js'
import { DEFAULT_DAILY_FORMAT, dailyFormatOf } from '../src/daily-format.js'
import { loadDaily } from '../src/daily.js'
import { loadState } from '../src/state.js'
import { parseAgentAction } from '../src/agent.js'

// 架空の見本の案件（読むだけ。書き換えない）
const EXAMPLE = resolve(import.meta.dirname, '../../../examples/lend-v12')
const GLOSSARY = resolve(import.meta.dirname, '../../ui/static/glossary.tsv')

const headersOf = (headers: Record<string, string>) => ({ headers } as unknown as IncomingMessage)

describe('requestLang（画面からの頼みの言語）', () => {
  test('x-tadori-lang を最初に見て、無ければ Accept-Language の書かれた順で決める', () => {
    expect(requestLang(headersOf({ 'x-tadori-lang': 'en', 'accept-language': 'ja' }))).toBe('en')
    expect(requestLang(headersOf({ 'accept-language': 'fr-FR,ja;q=0.9,en;q=0.8' }))).toBe('ja')
    expect(requestLang(headersOf({ 'accept-language': 'en-US,en;q=0.9' }))).toBe('en')
    expect(requestLang(headersOf({}))).toBeUndefined()
  })
})

describe('server の誤りの文は、頼みの言語で返す', () => {
  let server: RunningServer
  let base = ''
  beforeAll(async () => {
    server = await startServer({ dir: EXAMPLE, port: 0, today: '2026-11-05', uiDir: null })
    base = `http://127.0.0.1:${(server.address as AddressInfo).port}`
  })
  afterAll(async () => {
    await server.close()
  })

  test('x-tadori-lang: en なら英語', async () => {
    const res = await fetch(`${base}/api/trace/NOPE`, { headers: { 'x-tadori-lang': 'en' } })
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('That ID is not in the ledger')
  })

  test('Accept-Language: en でも英語。書き込みの検査の文も英語', async () => {
    const res = await fetch(`${base}/api/settings/phases`, { method: 'PUT', headers: { 'accept-language': 'en-US,en;q=0.9', 'content-type': 'application/json' }, body: '[]' })
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('This write did not come from the tadori screen')
  })

  test('言語を渡さなければ、処理の既定（テストでは日本語）', async () => {
    const res = await fetch(`${base}/api/trace/NOPE`)
    expect((await res.json()).error).toBe('その ID は台帳にありません')
  })
})

describe('tadori check の文（英語）', () => {
  test('withLang(en) の中では、件数と見出しが英語になる', async () => {
    const { state } = await loadState(EXAMPLE, '2026-11-05')
    const text = withLang('en', () => formatCheck(state))
    expect(text).toMatch(/\(as of 2026-11-05\)/)
    expect(text).toMatch(/started before the .+ phase gate/)
    expect(text).toMatch(/^Gaps: \d+ \/ Pending approval: \d+$/m)
    expect(text).not.toMatch(/漏れ \d+ 件/)
  })
})

describe('MCP の道具の説明（英語）', () => {
  test('tools/list の説明は、受けたときの言語で組み立てる', async () => {
    const handle = createMcpHandler({ glossaryPath: GLOSSARY, version: '0.0.1', projectDir: EXAMPLE, today: '2026-11-05' })
    type Listed = { result: { tools: Array<{ name: string; description: string; inputSchema: { properties: Record<string, { description?: string }> } }> } }
    const en = await withLang('en', () => handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' })) as Listed
    const ja = await handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) as Listed
    const enRemaining = en.result.tools.find(t => t.name === 'get_remaining')
    expect(enRemaining?.description).toMatch(/^Return the remaining work per phase/)
    expect(en.result.tools.find(t => t.name === 'item_add')?.inputSchema.properties.id?.description).toBe('Row ID')
    expect(ja.result.tools.find(t => t.name === 'get_remaining')?.description).toMatch(/^工程ごとの残課題/)
    // 日本語の文字が残っていない（担当の書き方の例「A・B」は台帳の書き方そのものなので除く）
    expect(JSON.stringify(en).replace(/A・B/g, '')).not.toMatch(/[぀-ヿ一-鿿]/)
  })

  test('道具の返事も英語', async () => {
    const handle = createMcpHandler({ glossaryPath: GLOSSARY, version: '0.0.1', projectDir: EXAMPLE, today: '2026-11-05' })
    const res = await withLang('en', () => handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'trace', arguments: { id: 'NOPE' } } })) as { result: { content: Array<{ text: string }> } }
    expect(res.result.content[0]?.text).toBe('NOPE is not in the ledger. Search with find_items')
  })
})

describe('1 日の進行の既定の見出し（英語）', () => {
  test('既定の形は読むときの言語に合わせ、案件が書いた値は訳さない', async () => {
    expect(withLang('en', () => ({ ...DEFAULT_DAILY_FORMAT }).consult)).toBe('Questions')
    expect(({ ...DEFAULT_DAILY_FORMAT }).consult).toBe('相談')
    expect(withLang('en', () => dailyFormatOf({ consult: '相談したいこと' }).consult)).toBe('相談したいこと')
    const daily = await withLang('en', () => loadDaily(EXAMPLE, '2026-11-09'))
    expect(daily.text).toMatch(/^Today \(11\/9 Mon\): \d+$/m)
    expect(daily.text).toMatch(/^Next working day \(11\/10 Tue\)$/m)
    expect(daily.text).toMatch(/^Questions$/m)
    expect(daily.text).toMatch(/^Notes$/m)
  })
})

describe('画面の専用カーソルへの指示の誤り（英語）', () => {
  test('知らない動きは英語で断る', () => {
    expect(() => withLang('en', () => parseAgentAction({ action: 'jump' }))).toThrow('Unknown action: jump (available: point / click / type / go / say / filter)')
  })
})

describe('チェックの記録の結果の欄（言語ごとの形）', () => {
  test('英語は「Gaps: 2 (A, B)」「Met」、日本語は「漏れ 2 件（A・B）」「満たす」', async () => {
    const { leakResult } = await import('../src/check-log.js')
    expect(leakResult(['DD-2.3', 'DD-3.2'], true)).toBe('Gaps: 2 (DD-2.3, DD-3.2)')
    expect(leakResult([], true)).toBe('Met')
    expect(leakResult(['DD-2.3', 'DD-3.2'], false)).toBe('漏れ 2 件（DD-2.3・DD-3.2）')
  })
})
