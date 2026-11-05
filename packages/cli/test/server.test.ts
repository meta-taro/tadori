import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { AddressInfo } from 'node:net'
import { request } from 'node:http'
import { startServer, type RunningServer } from '../src/server.js'

// 架空の見本の案件を一時フォルダに写して使う（見本そのものは書き換えない）
const EXAMPLE = resolve(import.meta.dirname, '../../../examples/lend-v12')
let dir = ''
let server: RunningServer
let base = ''

const WRITE_HEADERS = { 'content-type': 'application/json', 'x-tadori': '1' }

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tadori-cli-'))
  await cp(EXAMPLE, dir, { recursive: true })
  server = await startServer({ dir, port: 0, today: '2026-11-05', uiDir: resolve(import.meta.dirname, '../../ui/static') })
  base = `http://127.0.0.1:${(server.address as AddressInfo).port}`
})

afterAll(async () => {
  await server.close()
  await rm(dir, { recursive: true, force: true })
})

describe('GET /api/state', () => {
  test('工程の完了判定・漏れ・WBS を返す', async () => {
    const res = await fetch(`${base}/api/state`)
    expect(res.status).toBe(200)
    const state = await res.json()
    expect(state.project.name).toContain('備品貸出アプリ')
    expect(state.gates.map((g: { phase: { id: string } }) => g.phase.id)).toEqual(['bd', 'dd', 'impl', 'it', 'rel'])
    expect(state.today).toBe('2026-11-05')
    // 基本設計は差し戻しのまま → 詳細設計は前の完了判定より前に着手
    const dd = state.gates.find((g: { phase: { id: string } }) => g.phase.id === 'dd')
    expect(dd.startedBefore.id).toBe('bd')
  })
})

describe('GET /api/trace/:id', () => {
  test('指摘から辿り、試験の記録が無い所を切れ目として返す', async () => {
    const res = await fetch(`${base}/api/trace/F-02`)
    const result = await res.json()
    const missing = result.steps.filter((s: { type: string }) => s.type === 'missing')
    expect(missing).toContainEqual({ type: 'missing', after: 'TC-07', rule: 'R9', kind: 'RUN' })
  })

  test('無い ID は 404', async () => {
    expect((await fetch(`${base}/api/trace/NOPE`)).status).toBe(404)
  })
})

/** fetch では Host を変えられないので、node:http で送る */
function rawRequest(path: string, headers: Record<string, string>, method = 'GET', body = ''): Promise<number> {
  const port = (server.address as AddressInfo).port
  return new Promise((done, fail) => {
    const req = request({ host: '127.0.0.1', port, path, method, headers }, res => { res.resume(); done(res.statusCode ?? 0) })
    req.on('error', fail)
    req.end(body)
  })
}

describe('手元以外からの呼び出しを断る', () => {
  test('Host が 127.0.0.1 / localhost でなければ断る（DNS を差し替えて手元のサーバーを読ませる攻撃を防ぐ）', async () => {
    expect(await rawRequest('/api/state', { host: 'evil.example:4870' })).toBe(403)
  })

  test('書き込みは、Origin がこのサーバー自身でなければ断る', async () => {
    const port = (server.address as AddressInfo).port
    const status = await rawRequest('/api/tasks/W-09/status', {
      host: `127.0.0.1:${port}`, origin: 'http://evil.example', 'x-tadori': '1', 'content-type': 'application/json',
    }, 'PUT', JSON.stringify({ status: 'doing' }))
    expect(status).toBe(403)
  })

  test('壊れた % の書き方は 400（サーバーの中の問題にしない）', async () => {
    expect((await fetch(`${base}/api/trace/%E0%A4%A`)).status).toBe(400)
  })

  test('画面のファイルには、外のスクリプトを読ませない CSP を付ける', async () => {
    const res = await fetch(`${base}/index.html`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-security-policy')).toContain("default-src 'self'")
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
  })
})

describe('書き込み', () => {
  test('x-tadori ヘッダの無い書き込みは断る（ほかのサイトからの書き込みを防ぐ）', async () => {
    const res = await fetch(`${base}/api/settings/phases`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '[]' })
    expect(res.status).toBe(403)
  })

  test('使われている工程を消す変更は、理由つきで断る', async () => {
    const res = await fetch(`${base}/api/settings/phases`, { method: 'PUT', headers: WRITE_HEADERS, body: JSON.stringify([{ id: 'dd', name: '詳細設計', order: 1 }]) })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.problems.join('\n')).toMatch(/基本設計/)
  })

  test('工程の名前を変えると TSV に書き戻す（git 管理外なので commit はしない）', async () => {
    const state = await (await fetch(`${base}/api/state`)).json()
    const next = state.phases.map((p: { id: string; name: string; order: number }) => (p.id === 'it' ? { ...p, name: '結合試験' } : p))
    const res = await fetch(`${base}/api/settings/phases`, { method: 'PUT', headers: WRITE_HEADERS, body: JSON.stringify(next) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.commit.committed).toBe(false)
    expect(await readFile(join(dir, '.tadori/phases.tsv'), 'utf8')).toContain('it\t結合試験\t4')
  })

  test('WBS のタスクのステータスを変えると wbs.tsv に書き戻す', async () => {
    const res = await fetch(`${base}/api/tasks/W-09/status`, { method: 'PUT', headers: WRITE_HEADERS, body: JSON.stringify({ status: 'doing' }) })
    expect(res.status).toBe(200)
    expect(await readFile(join(dir, 'ledger/wbs.tsv'), 'utf8')).toMatch(/W-09\tit\t試験ケースの作成\t2026-11-16\t2026-11-24\tdoing/)
  })

  test('同時に 2 つ書き込んでも、両方とも残る（書き込みは 1 本の列に並べる）', async () => {
    const put = (id: string, status: string) => fetch(`${base}/api/tasks/${id}/status`, { method: 'PUT', headers: WRITE_HEADERS, body: JSON.stringify({ status }) })
    const results = await Promise.all([put('W-10', 'doing'), put('W-11', 'hold'), put('W-08', 'done')])
    expect(results.map(r => r.status)).toEqual([200, 200, 200])
    const wbs = await readFile(join(dir, 'ledger/wbs.tsv'), 'utf8')
    expect(wbs).toMatch(/W-10\t.*\tdoing/)
    expect(wbs).toMatch(/W-11\t.*\thold/)
    expect(wbs).toMatch(/W-08\t.*\tdone/)
  })

  test('設定に無いステータスは断る', async () => {
    const res = await fetch(`${base}/api/tasks/W-09/status`, { method: 'PUT', headers: WRITE_HEADERS, body: JSON.stringify({ status: 'nope' }) })
    expect(res.status).toBe(400)
  })
})
