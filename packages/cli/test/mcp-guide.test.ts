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

describe('MCP で 1 日の進行を作る・足す・直す・消す', () => {
  const EXAMPLE = resolve(import.meta.dirname, '../../../examples/lend-v12')
  let dir = ''
  let tool: ReturnType<typeof toolOf>
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'tadori-mcp-daily-'))
    await cp(EXAMPLE, dir, { recursive: true })
    tool = toolOf(createMcpHandler({ glossaryPath: GLOSSARY, guidePath: GUIDE, version: '0.0.1', projectDir: dir, today: '2026-11-05' }))
  })
  afterAll(async () => { await rm(dir, { recursive: true, force: true }) })

  test('daily_generate で置き、daily で行の ID が見え、daily_add・daily_update・daily_remove で直せる', async () => {
    expect((await tool('daily_generate', { date: '2026-11-05' })).isError).toBeUndefined()
    const listed = (await tool('daily', { date: '2026-11-05' })).content[0]?.text ?? ''
    const id = listed.match(/\[(a\d+)\]/)?.[1]
    expect(id).toBeDefined()
    expect((await tool('daily_update', { date: '2026-11-05', id, text: '観点表を半分まで書いた' })).isError).toBeUndefined()
    const added = await tool('daily_add', { date: '2026-11-05', who: '検証担当', section: 'consult', text: '試験の環境はいつ空くか確かめたい' })
    const addedId = added.content[0]?.text.match(/\[(m\d+)\]/)?.[1]
    expect(addedId).toBe('m1')
    expect((await tool('daily_remove', { date: '2026-11-05', id: addedId })).isError).toBeUndefined()
    const after = (await tool('daily', { date: '2026-11-05' })).content[0]?.text ?? ''
    expect(after).toContain('観点表を半分まで書いた')
    expect(after).not.toContain('試験の環境はいつ空くか')
  })

  test('issue を渡して足した行・直した行も、自動の行と同じく頭に課題番号と短い件名が付く（二重には付けない）', async () => {
    const added = await tool('daily_add', { date: '2026-11-05', who: '設計担当', section: 'today', text: '祝日の扱いを確かめた', issue: 'Q-1' })
    const id = added.content[0]?.text.match(/\[(m\d+)\]/)?.[1]
    await tool('daily_update', { date: '2026-11-05', id, text: 'Q-1 返却期限の祝日扱い 祝日の扱いを決めた' })
    const listed = (await tool('daily', { date: '2026-11-05' })).content[0]?.text ?? ''
    expect(listed).toContain('Q-1 返却期限の祝日扱い 祝日の扱いを決めた')
    expect(listed).not.toContain('Q-1 返却期限の祝日扱い Q-1')
    await tool('daily_add', { date: '2026-11-05', who: '設計担当', section: 'next', text: '祝日の一覧をもらう', issue: 'Q-1' })
    expect((await tool('daily', { date: '2026-11-05' })).content[0]?.text).toContain('Q-1 返却期限の祝日扱い 祝日の一覧をもらう')
  })

  test('links（表示名と URL）を付けて足せる。http・https 以外の URL は断る', async () => {
    const ok = await tool('daily_add', { date: '2026-11-05', who: '設計担当', section: 'today', text: 'QA を返した', links: [{ label: 'QA表', url: 'https://sheets.example.com/qa#row=12' }] })
    expect(ok.isError).toBeUndefined()
    expect((await tool('daily', { date: '2026-11-05' })).content[0]?.text).toContain('QA表：https://sheets.example.com/qa#row=12')
    const bad = await tool('daily_add', { date: '2026-11-05', who: '設計担当', section: 'today', text: 'x', links: [{ label: 'x', url: 'javascript:alert(1)' }] })
    expect(bad.isError).toBe(true)
  })

  test('links に anchor（本文の語）と nth を渡せる。本文に無い語は、足したうえで知らせる。同じリンクは 1 つにまとめる', async () => {
    const link = { label: 'QA表', url: 'https://sheets.example.com/qa', anchor: 'QA', nth: 2 }
    const ok = await tool('daily_add', { date: '2026-11-06', who: '設計担当', section: 'today', text: 'QA を読んで QA を返した', links: [link, link] })
    expect(ok.content[0]?.text).not.toContain('見つかりません')
    const listed = (await tool('daily', { date: '2026-11-06' })).content[0]?.text ?? ''
    expect(listed.match(/QA表：/g)).toHaveLength(1)
    const missing = await tool('daily_add', { date: '2026-11-06', who: '設計担当', section: 'today', text: 'MR を出した', links: [{ label: 'MR', url: 'https://git.example.com/mr/3', anchor: 'プルリク' }] })
    expect(missing.isError).toBeUndefined()
    expect(missing.content[0]?.text).toContain('「プルリク」が本文に見つかりません')
    const tooFar = await tool('daily_add', { date: '2026-11-06', who: '設計担当', section: 'today', text: 'MR を出した', links: [{ label: 'MR', url: 'https://git.example.com/mr/3', anchor: 'MR', nth: 2 }] })
    expect(tooFar.content[0]?.text).toContain('「MR」の 2 回目が本文に見つかりません')
  })

  test('daily_update で空文字（links・wbs は空の配列）を渡すと、その欄を空にする。本文だけは空にできない', async () => {
    const added = await tool('daily_add', { date: '2026-11-07', who: '設計担当', section: 'today', text: '観点を足した', note: '観点表 §2', issue: 'Q-1', wbs: ['W-08'], tag: 'done', links: [{ label: 'QA表', url: 'https://sheets.example.com/qa' }] })
    const id = added.content[0]?.text.match(/\[(m\d+)\]/)?.[1]
    expect((await tool('daily_update', { date: '2026-11-07', id, note: '', issue: '', wbs: [], tag: '', links: [] })).isError).toBeUndefined()
    const listed = (await tool('daily', { date: '2026-11-07' })).content[0]?.text ?? ''
    expect(listed).not.toContain('観点表 §2')
    expect(listed).not.toContain('QA表')
    // W-08 は WBS から作る次の作業日の行にも出るので、足した行だけを見る
    const row = listed.split('\n').find(l => l.includes('観点を足した')) ?? ''
    expect(row).not.toContain('W-08')
    expect(row).not.toContain('［済］')
    const empty = await tool('daily_update', { date: '2026-11-07', id, text: '' })
    expect(empty.isError).toBe(true)
    expect(empty.content[0]?.text).toContain('daily_remove')
  })

  test('無い行を直そうとしたら isError', async () => {
    expect((await tool('daily_update', { date: '2026-11-05', id: 'zz9', text: 'a' })).isError).toBe(true)
  })
})

describe('how_to と initialize の版', () => {
  test('how_to を話題なしで呼ぶと、1 行目に版と組んだ commit を出す（席が新しい道具を見られなくても版が分かるように）', async () => {
    const { mkdtemp, rm, writeFile } = await import('node:fs/promises')
    const dir = await mkdtemp(join(tmpdir(), 'tadori-build-'))
    try {
      await writeFile(join(dir, 'build-info.json'), JSON.stringify({ builtAt: '2026-11-10T07:29:51Z', commit: '7a08b11' }), 'utf8')
      const handler = createMcpHandler({ glossaryPath: GLOSSARY, guidePath: GUIDE, version: '0.0.1', buildDir: dir, sourceDirs: [] })
      const first = (await toolOf(handler)('how_to')).content[0]?.text.split('\n')[0] ?? ''
      expect(first).toContain('tadori 0.0.1')
      expect(first).toContain('7a08b11')
      const init = await handler({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) as { result: { serverInfo: { version: string } } }
      expect(init.result.serverInfo.version).toBe('0.0.1+7a08b11')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
