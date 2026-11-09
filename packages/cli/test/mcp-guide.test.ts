import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { cp, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { AddressInfo } from 'node:net'
import { createMcpHandler } from '../src/mcp.js'
import { startServer, type RunningServer } from '../src/server.js'

const GLOSSARY = resolve(import.meta.dirname, '../../ui/static/glossary.tsv')
const GUIDE = resolve(import.meta.dirname, '../guide.md')
type ToolResult = { content: Array<{ type: string; text: string }>; isError?: boolean }

function toolOf(handler: ReturnType<typeof createMcpHandler>) {
  return async (name: string, args: Record<string, unknown> = {}) => {
    const res = await handler({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) as { result: ToolResult }
    return res.result
  }
}

describe('how_to（使い方）', () => {
  const tool = toolOf(createMcpHandler({ glossaryPath: GLOSSARY, guidePath: GUIDE, version: '0.0.1' }))

  test('topic を渡さなければ、話題の一覧と、最初に読むものを返す', async () => {
    const result = await tool('how_to')
    expect(result.isError).toBeUndefined()
    for (const topic of ['start', 'ledger', 'rules', 'check', 'screen', 'agent-rules']) expect(result.content[0]?.text).toContain(topic)
  })

  test('topic を渡すと、その使い方だけを返す', async () => {
    const result = await tool('how_to', { topic: 'rules' })
    expect(result.content[0]?.text).toMatch(/covered/)
    expect(result.content[0]?.text).not.toMatch(/## start/)
  })

  test('エージェントが守ること（承認しない・漏れを埋めたと判定しない）を返す', async () => {
    const text = (await tool('how_to', { topic: 'agent-rules' })).content[0]?.text ?? ''
    expect(text).toMatch(/承認/)
    expect(text).toMatch(/漏れを埋めた/)
  })

  test('知らない topic は、一覧を添えて isError', async () => {
    const result = await tool('how_to', { topic: 'nope' })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('start')
  })
})

describe('screen（画面の中の専用カーソルで操作する）', () => {
  const EXAMPLE = resolve(import.meta.dirname, '../../../examples/lend-v12')
  let dir = ''
  let server: RunningServer
  let port = 0
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'tadori-screen-'))
    await cp(EXAMPLE, dir, { recursive: true })
    server = await startServer({ dir, port: 0, today: '2026-11-05', uiDir: resolve(import.meta.dirname, '../../ui/static') })
    port = (server.address as AddressInfo).port
  })
  afterAll(async () => {
    await server.close()
    await rm(dir, { recursive: true, force: true })
  })

  test('画面が開いていなければ、そう言って断る', async () => {
    const tool = toolOf(createMcpHandler({ glossaryPath: GLOSSARY, guidePath: GUIDE, version: '0.0.1', screenUrl: `http://127.0.0.1:${port}` }))
    const result = await tool('screen', { action: 'click', target: 'ルールセット' })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toMatch(/画面が開いていません/)
  })

  test('画面が開いていれば、指示を届けたと返す', async () => {
    const controller = new AbortController()
    await fetch(`http://127.0.0.1:${port}/api/events`, { signal: controller.signal })
    const tool = toolOf(createMcpHandler({ glossaryPath: GLOSSARY, guidePath: GUIDE, version: '0.0.1', screenUrl: `http://127.0.0.1:${port}` }))
    const result = await tool('screen', { action: 'click', target: 'ルールセット', message: 'ルールを見ます' })
    controller.abort()
    expect(result.isError).toBeUndefined()
    expect(result.content[0]?.text).toMatch(/届けました/)
  })

  test('tadori が立ち上がっていなければ、立ち上げ方を添えて断る', async () => {
    const tool = toolOf(createMcpHandler({ glossaryPath: GLOSSARY, guidePath: GUIDE, version: '0.0.1', screenUrl: 'http://127.0.0.1:1' }))
    const result = await tool('screen', { action: 'say', message: 'こんにちは' })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toMatch(/立ち上/)
  })
})
