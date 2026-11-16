import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { execFileSync } from 'node:child_process'
import { appendFile, cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createMcpHandler } from '../src/mcp.js'

const GLOSSARY = resolve(import.meta.dirname, '../../ui/static/glossary.tsv')
const EXAMPLE = resolve(import.meta.dirname, '../../../examples/lend-v12')
type ToolResult = { content: Array<{ type: string; text: string }>; isError?: boolean }

let dir = ''
let handle: ReturnType<typeof createMcpHandler>
const tool = async (name: string, args: Record<string, unknown> = {}) =>
  ((await handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })) as { result: ToolResult }).result

const commitAt = (date: string, message: string) => {
  execFileSync('git', ['add', '.'], { cwd: dir })
  execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.invalid', 'commit', '-q', '-m', message], { cwd: dir, env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } })
}

// 見本の案件を写し、基本設計書を 2 回変えて、間に承認を置く（承認のルールは基本設計の章 BD を見る）
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tadori-docs-'))
  await cp(EXAMPLE, dir, { recursive: true })
  execFileSync('git', ['init', '-q'], { cwd: dir })
  await appendFile(join(dir, '.tadori/rulesets/basic-design.tsv'), 'R90\tbd\tapproval\tBD\t\t\t\t\t\t基本設計書の承認（試験用）\n', 'utf8')
  await appendFile(join(dir, 'ledger/approvals.tsv'), 'R90\t承認\tレビュー担当\t2026-10-10\n', 'utf8')
  await mkdir(join(dir, 'docs'), { recursive: true })
  await writeFile(join(dir, 'docs/basic-design.md'), '## 2 貸出\n上限は 5 冊\n', 'utf8')
  commitAt('2026-10-01T09:00:00+09:00', '基本設計の初版')
  await writeFile(join(dir, 'docs/basic-design.md'), '## 2 貸出\n上限は 10 冊\n', 'utf8')
  commitAt('2026-10-15T09:00:00+09:00', '貸出の上限を直す')
  handle = createMcpHandler({ glossaryPath: GLOSSARY, version: '0.0.1', projectDir: dir, today: '2026-11-05' })
})
afterAll(async () => { await rm(dir, { recursive: true, force: true }) })

describe('doc_versions（資料の版と差分）', () => {
  test('行の ID から文書の版を新しい順に並べ、承認した版に印を付け、承認した版からいままでの差分を返す', async () => {
    const result = await tool('doc_versions', { id: 'BD-2' })
    const body = result.content[0]?.text ?? ''
    expect(result.isError).toBeUndefined()
    expect(body).toContain('docs/basic-design.md（指す行：BD-2, BD-3）')
    expect(body).toMatch(/貸出の上限を直す[\s\S]*基本設計の初版 ← 承認した版/)
    expect(body).toMatch(/2026-10-10 に承認した版（R90/)
    expect(body).toContain('-上限は 5 冊')
    expect(body).toContain('+上限は 10 冊')
  })

  test('承認の無い文書は、版だけ並べて、from を渡せば差分を出すと言う', async () => {
    const body = (await tool('doc_versions', { id: 'DD-2.3' })).content[0]?.text ?? ''
    expect(body).toContain('docs/detail-design.md')
    expect(body).toContain('版がありません')
  })

  test('台帳に名前の無いファイルは読まない・commit の ID でない from は断る', async () => {
    expect((await tool('doc_versions', { id: 'package.json' })).isError).toBe(true)
    expect((await tool('doc_versions', { id: '.tadori/project.tsv' })).isError).toBe(true)
    const bad = await tool('doc_versions', { id: 'BD-2', from: '--output=x' })
    expect(bad.isError).toBe(true)
    expect(bad.content[0]?.text).toContain('commit の ID ではありません')
  })
})
