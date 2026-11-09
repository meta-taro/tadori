import { describe, expect, test } from 'vitest'
import { resolve } from 'node:path'
import { withLang } from '@tadori/core'
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

  test('英語では英語の使い方（guide.md）を返し、話題の一覧と案内も英語になる', async () => {
    const start = await withLang('en', () => howTo(GUIDE, 'start'))
    expect(start.text).toMatch(/^## start Getting started/)
    expect(start.text).toMatch(/restart Claude Code/)
    const list = await withLang('en', () => howTo(GUIDE, ''))
    expect(list.text).toContain('Topics (pass as topic):')
    expect(list.text).toContain('- agent-rules: What agents must follow')
    const missing = await withLang('en', () => howTo(GUIDE, 'nope'))
    expect(missing.isError).toBe(true)
    expect(missing.text).toContain('There is no topic "nope".')
  })

  test('英語と日本語の使い方は、同じ話題を同じ順に持つ', async () => {
    const topicsOf = (text: string) => text.split('\n').filter(line => line.startsWith('- ')).map(line => line.slice(2).split(/[:：]/)[0])
    const en = await withLang('en', () => howTo(GUIDE, ''))
    const ja = await withLang('ja', () => howTo(GUIDE, ''))
    expect(topicsOf(en.text)).toEqual(topicsOf(ja.text))
  })
})
