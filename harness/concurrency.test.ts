// 1 台の PC で何人ものエージェント（席）が同じ案件を同時に使う。
// ある席の遅い呼び出し（ここでは commit 前の検査が遅い案件への書き込み）の間に、
// ほかの席の呼び出しが黙って止まらないことを、組んだ serve と MCP を本物のプロセスで起こして確かめる。
import { spawnSync } from 'node:child_process'
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { EXAMPLE, harnessEnv, requireBuilt, startMcp, startServe } from './run.js'

/** commit 前の検査（pre-commit）にかかる秒数。この間、書き込みは終わらない */
const SLOW_HOOK_SECONDS = 8
/** 「すぐ返る」とみなす上限 */
const QUICK_MS = 3_000
/** 書き込みが並んだときに待つ上限（これを過ぎたら「いま別の書き込みをしています」と返す） */
const BUSY_REPLY_MS = 5_000

let dir = ''

function git(args: readonly string[]): void {
  const result = spawnSync('git', args, { cwd: dir, env: harnessEnv(), encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`)
}

/** 見本を写して自分の git リポジトリにし、commit 前の検査を遅くする */
async function slowProject(): Promise<void> {
  dir = await mkdtemp(join(tmpdir(), 'tadori-harness-busy-'))
  await cp(EXAMPLE, dir, { recursive: true })
  git(['init', '-q'])
  git(['-c', 'user.name=harness', '-c', 'user.email=harness@example.invalid', 'add', '-A'])
  git(['-c', 'user.name=harness', '-c', 'user.email=harness@example.invalid', 'commit', '-q', '-m', 'init'])
  git(['config', 'user.name', 'harness'])
  git(['config', 'user.email', 'harness@example.invalid'])
  await writeFile(join(dir, '.git/hooks/pre-commit'), `#!/bin/sh\nsleep ${SLOW_HOOK_SECONDS}\n`, { mode: 0o755 })
}

async function timed<T>(work: () => Promise<T>): Promise<{ ms: number; value: T }> {
  const started = Date.now()
  const value = await work()
  return { ms: Date.now() - started, value }
}

const wait = (ms: number) => new Promise(r => setTimeout(r, ms))

beforeAll(async () => {
  requireBuilt()
  await slowProject()
})
afterAll(async () => { await rm(dir, { recursive: true, force: true }) })

describe('画面の server（席どうしで 1 つを共有する）', () => {
  test('遅い書き込みの間も、読む呼び出しはすぐ返り、次の書き込みは待たされ続けずに「いま別の書き込みをしています」と返る', async () => {
    const serve = await startServe(dir)
    try {
      const write = (text: string) => fetch(new URL('api/daily/2026-10-30/entries', serve.url), {
        method: 'POST', headers: { 'x-tadori': '1', 'content-type': 'application/json' },
        body: JSON.stringify({ who: '設計担当', section: 'today', text }),
      })
      const slow = write('遅い書き込み')
      await wait(1_000) // 遅い書き込みが commit 前の検査に入るのを待つ

      const read = await timed(() => fetch(new URL('api/state', serve.url), { headers: { 'x-tadori': '1' } }))
      expect(read.value.status).toBe(200)
      expect(read.ms).toBeLessThan(QUICK_MS)

      const second = await timed(() => write('次の書き込み'))
      expect(second.ms).toBeLessThan(BUSY_REPLY_MS + 1_000)
      expect(second.value.status).toBe(409)
      expect((await second.value.json() as { error: string }).error).toContain('別の書き込み')

      expect((await slow).status).toBe(200)
    } finally {
      serve.close()
    }
  }, 40_000)
})

describe('MCP（席ごとに別のプロセス・同じ案件）', () => {
  test('ある席の遅い書き込みの間も、ほかの席の読む道具はすぐ返り、書く道具は git の生の誤りではなく何が起きたかを返す', async () => {
    const seatA = startMcp([dir])
    const seatB = startMcp([dir])
    try {
      const add = (seat: ReturnType<typeof startMcp>, id: string) => seat.request('tools/call', { name: 'item_add', arguments: { id, kind: 'BD', title: `${id} の章` } })
      const slow = add(seatA, 'BD-90')
      await wait(1_500)

      const read = await timed(() => seatB.request('tools/call', { name: 'get_remaining', arguments: {} }))
      expect(read.value.result?.isError).toBeFalsy()
      expect(read.ms).toBeLessThan(QUICK_MS)

      const second = await timed(() => add(seatB, 'BD-91'))
      expect(second.ms).toBeLessThan(BUSY_REPLY_MS + 1_000)
      const message = String(second.value.result?.content?.[0]?.text ?? '')
      expect(message).not.toContain('index.lock')
      expect(message).toContain('別の')

      expect(String((await slow).result?.content?.[0]?.text)).toContain('commit')
    } finally {
      seatA.close()
      seatB.close()
    }
  }, 40_000)
})
