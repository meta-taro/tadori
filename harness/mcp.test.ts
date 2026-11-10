// 組んだ MCP を本物のプロセス（標準入出力）で起こし、エージェントの席と同じ順で話す
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { EXAMPLE, requireBuilt, startMcp } from './run.js'

let build = { commit: '', builtAt: '' }
const mcp = startMcp([EXAMPLE])
beforeAll(() => { build = requireBuilt() })
afterAll(() => { mcp.close() })

/** 読むだけの道具と、試すときの引数（書く道具・画面を動かす道具は、ここでは呼ばない） */
const READ_TOOLS: Record<string, Record<string, unknown>> = {
  get_remaining: {},
  list_leaks: {},
  list_rules: {},
  trace: { id: 'F-02' },
  find_items: { query: 'TC' },
  daily: {},
  glossary: { query: '漏れ' },
  how_to: {},
  version: {},
  list_projects: {},
}

describe('MCP のプロセス', () => {
  test('つなぐときに名乗る版に、組んだ commit が付く（席が後から足した道具を見られなくても、どの版か分かる）', async () => {
    const res = await mcp.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'harness', version: '0' } })
    expect(build.commit).not.toBe('')
    expect(res.result?.serverInfo?.version).toMatch(new RegExp(`\\+${build.commit}$`))
  })

  test('道具の一覧に、読む道具が全部ある', async () => {
    const res = await mcp.request('tools/list')
    const names = (res.result?.tools as Array<{ name: string }>).map(t => t.name)
    for (const name of Object.keys(READ_TOOLS)) expect(names, name).toContain(name)
  })

  test.each(Object.entries(READ_TOOLS))('%s は誤りを返さない', async (name, args) => {
    const res = await mcp.request('tools/call', { name, arguments: args })
    expect(res.error, name).toBeUndefined()
    expect(res.result?.isError, `${name}: ${res.result?.content?.[0]?.text}`).toBeFalsy()
    expect(res.result?.content?.[0]?.text, name).not.toBe('')
  })

  test('話題なしの how_to の 1 行目と version は、組んだ commit を出す', async () => {
    const howTo = await mcp.request('tools/call', { name: 'how_to', arguments: {} })
    expect(howTo.result.content[0].text.split('\n')[0]).toContain(build.commit)
    const version = await mcp.request('tools/call', { name: 'version', arguments: {} })
    expect(version.result.content[0].text).toContain(build.commit)
  })
})
