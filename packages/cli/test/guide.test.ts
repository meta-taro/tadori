import { describe, expect, test } from 'vitest'
import { resolve } from 'node:path'
import { howTo } from '../src/guide.js'

const GUIDE = resolve(import.meta.dirname, '../guide.md')

describe('howTo（CLI の tadori how-to と MCP の how_to が同じものを返す）', () => {
  test('話題を渡さなければ一覧、渡せばその使い方、知らない話題は isError', async () => {
    expect((await howTo(GUIDE, '')).text).toContain('agent-rules')
    expect((await howTo(GUIDE, 'start')).text).toMatch(/^## start/)
    expect((await howTo(GUIDE, 'nope')).isError).toBe(true)
  })

  test('はじめ方に、MCP を登録したら Claude Code を立ち上げ直すことが書いてある', async () => {
    expect((await howTo(GUIDE, 'start')).text).toMatch(/立ち上げ直/)
  })
})
