// 組んだ serve を本物のプロセスで起こし、画面が読むものを全部取りに行く
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { EXAMPLE, requireBuilt, startServe } from './run.js'

/** 画面の HTML と JS から、読みに行く手元のファイル（src・href・import）を集める */
function localRefs(text: string, isHtml: boolean): string[] {
  const refs = [
    // HTML の src・href だけを見る（JS の中の雛形の文字は、読みに行く先ではない）
    ...(isHtml ? [...text.matchAll(/(?:src|href)="([^"#:]+)"/g)].map(m => m[1] as string) : []),
    // 行頭の import 文だけを見る（JSDoc の import('./types') は型の注釈で、読みに行かない）
    ...[...text.matchAll(/^\s*(?:import\s*['"]|(?:import|export)\b[^'"\n(]*\bfrom\s*['"])(\.\.?\/[^'"]+)['"]/gm)].map(m => m[1] as string),
  ]
  return [...new Set(refs.filter(r => !r.startsWith('//')))]
}

describe('手元でソースから組んだ serve（デスクトップの版を渡さない）', () => {
  let serve: Awaited<ReturnType<typeof startServe>>
  beforeAll(async () => {
    requireBuilt()
    serve = await startServe(EXAMPLE)
  })
  afterAll(() => { serve?.close() })

  test('画面が読むファイル（HTML から辿れる JS・CSS・ほかの JS が import するもの）が全部ある', async () => {
    const seen = new Set<string>()
    const queue = ['']
    while (queue.length) {
      const path = queue.shift() as string
      if (seen.has(path)) continue
      seen.add(path)
      const res = await fetch(new URL(path, serve.url))
      expect(res.status, `/${path}`).toBe(200)
      if (path === '' || path.endsWith('.js') || path.endsWith('.html')) {
        for (const ref of localRefs(await res.text(), !path.endsWith('.js'))) queue.push(new URL(ref, new URL(path, serve.url)).pathname.slice(1))
      }
    }
    expect(seen.size).toBeGreaterThan(5)
  })

  test('/api/state は工程ごとの判定と、statuses.tsv に無い状態の欄を返す', async () => {
    const state = await (await fetch(new URL('api/state', serve.url), { headers: { 'x-tadori': '1' } })).json() as { gates: unknown[]; unknownStatuses: unknown[] }
    expect(state.gates.length).toBeGreaterThan(0)
    expect(state.unknownStatuses).toEqual([])
  })

  test('/api/update は、手元で組んだ版として新しい版を出さない', async () => {
    const res = await fetch(new URL('api/update', serve.url), { headers: { 'x-tadori': '1' } })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ isNewer: false, isSourceBuild: true })
  })

  test('/api/daily と /api/version が返る', async () => {
    expect((await fetch(new URL('api/daily?date=2026-10-30', serve.url), { headers: { 'x-tadori': '1' } })).status).toBe(200)
    const version = await (await fetch(new URL('api/version', serve.url), { headers: { 'x-tadori': '1' } })).json() as { commit: string }
    expect(version.commit).toBe(requireBuilt().commit)
  })
})

describe('配った版として起こした serve（デスクトップがアプリの版を渡す）', () => {
  test('/api/update は手元で組んだ版として扱わない（配った版は新しい版と比べる）', async () => {
    const serve = await startServe(EXAMPLE, { TADORI_APP_VERSION: '9.9.9' })
    try {
      const body = await (await fetch(new URL('api/update', serve.url), { headers: { 'x-tadori': '1' } })).json() as { isSourceBuild?: boolean }
      expect(body.isSourceBuild).not.toBe(true)
    } finally {
      serve.close()
    }
  })
})

describe('デスクトップアプリが落ちたとき', () => {
  test('親（デスクトップアプリ）のプロセスが急に終わったら、裏の serve も止まる（残って番号をふさがない）', async () => {
    const { spawn } = await import('node:child_process')
    const { CLI, harnessEnv } = await import('./run.js')
    // 親の代わり：serve を子として起こし、子の番号を出してから居続ける。親を強く止めて、子が止まるかを見る。
    // detached にする：Node の spawn は Windows で子を「親が閉じたら止める」組に入れるので、そのままだと
    // デスクトップアプリ（Rust の Command。その組を作らない）と違って、直さなくても子が止まって見えてしまう
    const script = String.raw`const { spawn } = require('node:child_process');
const child = spawn(process.execPath, [${JSON.stringify(CLI)}, 'serve', ${JSON.stringify(EXAMPLE)}, '--port', '0'], { env: { ...process.env, TADORI_PARENT_PID: String(process.pid) }, stdio: ['ignore', 'pipe', 'ignore'], detached: true });
child.stdout.on('data', d => { const m = String(d).match(/http:\/\/127\.0\.0\.1:\d+\//); if (m) console.log(JSON.stringify({ url: m[0], pid: child.pid })) });
setInterval(() => {}, 1000);`
    const parent = spawn(process.execPath, ['-e', script], { env: harnessEnv(), stdio: ['ignore', 'pipe', 'pipe'] })
    const info = await new Promise<{ url: string; pid: number }>((done, fail) => {
      const timer = setTimeout(() => fail(new Error('serve が立ち上がりません')), 15_000)
      parent.stdout.on('data', d => { clearTimeout(timer); done(JSON.parse(String(d).trim().split('\n')[0] as string)) })
    })
    expect((await fetch(info.url)).status).toBe(200)
    parent.kill('SIGKILL')
    // 数秒のうちに子も止まる
    const deadline = Date.now() + 10_000
    let alive = true
    while (alive && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 300))
      try { process.kill(info.pid, 0) } catch { alive = false }
    }
    if (alive) process.kill(info.pid)
    expect(alive).toBe(false)
  })
})
