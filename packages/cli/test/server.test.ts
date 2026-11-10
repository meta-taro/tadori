import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { AddressInfo } from 'node:net'
import { request } from 'node:http'
import { startServer, type RunningServer } from '../src/server.js'
import { readServerErrors } from '../src/error-log.js'

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

describe('対応済み', () => {
  test('前のチェックで漏れだったが、いまは漏れの無い行を resolved として返す', async () => {
    const state = await (await fetch(`${base}/api/state`)).json()
    const ids = state.resolved.map((r: { itemId: string }) => r.itemId)
    expect(ids).toEqual(expect.arrayContaining(['DD-3.2', 'TC-04']))
    expect(ids).not.toContain('DD-2.3') // いまも漏れ
  })
})

describe('ほかのアプリでの書き換えを知らせる', () => {
  test('案件の TSV が書き換わったら、/api/events に changed が届く', async () => {
    const controller = new AbortController()
    const res = await fetch(`${base}/api/events`, { signal: controller.signal })
    expect(res.headers.get('content-type')).toContain('text/event-stream')
    const reader = (res.body as ReadableStream<Uint8Array>).getReader()
    const decoder = new TextDecoder()
    // 少し待ってから、ほかのアプリが保存したつもりで書き換える
    setTimeout(() => { void readFile(join(dir, 'ledger/wbs.tsv'), 'utf8').then(t => writeFile(join(dir, 'ledger/wbs.tsv'), `${t}`, 'utf8')) }, 200)
    let received = ''
    const deadline = Date.now() + 3000
    while (!received.includes('event: changed') && Date.now() < deadline) {
      const { value, done } = await Promise.race([
        reader.read(),
        new Promise<{ value: undefined; done: true }>(r => setTimeout(() => r({ value: undefined, done: true }), deadline - Date.now())),
      ])
      if (done) break
      received += decoder.decode(value)
    }
    controller.abort()
    expect(received).toContain('event: changed')
  })
})

describe('md-business で開くリンク', () => {
  test('links.tsv に雛形があれば、漏れに直す行を開く URL を付ける', async () => {
    await writeFile(join(dir, '.tadori/links.tsv'), 'tool\turl\nmd-business\tmd-business://open?path={path}&line={line}\n', 'utf8')
    const state = await (await fetch(`${base}/api/state`)).json()
    const leak = state.leaks.find((l: { rule: string; itemId: string }) => l.rule === 'R4' && l.itemId === 'DD-2.3')
    expect(leak.openUrl).toBe('md-business://open?path=ledger%2Fitems.tsv&line=6')
    await rm(join(dir, '.tadori/links.tsv'))
  })

  test('{repopath} は git リポジトリの最上位からの場所（案件が git の外なら案件のフォルダからの場所）', async () => {
    await writeFile(join(dir, '.tadori/links.tsv'), 'tool\turl\nmd-business\tmd-business://open?repo=github.com/o/r&path={repopath}&line={line}\n', 'utf8')
    const state = await (await fetch(`${base}/api/state`)).json()
    const leak = state.leaks.find((l: { rule: string; itemId: string }) => l.rule === 'R4' && l.itemId === 'DD-2.3')
    expect(leak.openUrl).toBe('md-business://open?repo=github.com/o/r&path=ledger%2Fitems.tsv&line=6')
    await rm(join(dir, '.tadori/links.tsv'))
  })

  test('試験ケースの漏れには git-qa で実施する URL を付け、ほかの漏れには付けない', async () => {
    await writeFile(join(dir, '.tadori/links.tsv'), 'tool\turl\ngit-qa\tgit-qa://run?sheet={path}&case={id}\n', 'utf8')
    const state = await (await fetch(`${base}/api/state`)).json()
    const find = (rule: string, id: string) => state.leaks.find((l: { rule: string; itemId: string }) => l.rule === rule && l.itemId === id)
    expect(find('R9', 'TC-07')).toMatchObject({ runnable: true, runUrl: 'git-qa://run?sheet=qa%2Ftest-spec.tsv&case=TC-07' })
    expect(find('R4', 'DD-2.3')).toMatchObject({ runnable: false })
    expect(find('R4', 'DD-2.3').runUrl).toBeUndefined()
    await rm(join(dir, '.tadori/links.tsv'))
  })

  test('雛形が無くても、試験ケースの漏れには git-qa で実施できる印（runnable）が付く', async () => {
    const state = await (await fetch(`${base}/api/state`)).json()
    const tc07 = state.leaks.find((l: { rule: string; itemId: string }) => l.rule === 'R9' && l.itemId === 'TC-07')
    expect(tc07).toMatchObject({ runnable: true })
    expect(tc07.runUrl).toBeUndefined()
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

describe('エージェントの専用カーソル（POST /api/agent）', () => {
  test('画面がつながっていれば、指示を /api/events に agent として流す', async () => {
    const controller = new AbortController()
    const events = await fetch(`${base}/api/events`, { signal: controller.signal })
    const reader = (events.body as ReadableStream<Uint8Array>).getReader()
    const res = await fetch(`${base}/api/agent`, { method: 'POST', headers: WRITE_HEADERS, body: JSON.stringify({ action: 'click', target: 'ルールセット' }) })
    expect(res.status).toBe(200)
    let received = ''
    const deadline = Date.now() + 2000
    while (!received.includes('event: agent') && Date.now() < deadline) {
      const { value, done } = await reader.read()
      if (done) break
      received += new TextDecoder().decode(value)
    }
    controller.abort()
    expect(received).toContain('event: agent')
    expect(received).toContain('"target":"ルールセット"')
  })

  test('x-tadori の無い指示は断る（ほかのサイトから画面を操作させない）', async () => {
    const res = await fetch(`${base}/api/agent`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'say', message: 'x' }) })
    expect(res.status).toBe(403)
  })

  test('おかしな指示は 400', async () => {
    const res = await fetch(`${base}/api/agent`, { method: 'POST', headers: WRITE_HEADERS, body: JSON.stringify({ action: 'drag' }) })
    expect(res.status).toBe(400)
  })
})

describe('今日の日付', () => {
  test('--today を渡さずに立ち上げたら、読むたびにその日の日付を使う（開きっぱなしでも日付がずれない）', async () => {
    const { localToday } = await import('../src/state.js')
    const plain = await startServer({ dir, port: 0, uiDir: resolve(import.meta.dirname, '../../ui/static') })
    try {
      const state = await (await fetch(`http://127.0.0.1:${(plain.address as AddressInfo).port}/api/state`)).json()
      expect(state.today).toBe(localToday())
    } finally {
      await plain.close()
    }
  })
})

describe('GET /api/daily（人単位の 1 日の進行）', () => {
  test('1 日の進行の文と、担当の一覧を返す。担当で絞れる', async () => {
    const all = await (await fetch(`${base}/api/daily?date=2026-11-05`)).json()
    expect(all.text).toMatch(/^今日（11\/5 木）\d+ 件/)
    expect(all.owners).toEqual(expect.arrayContaining(['設計担当', '検証担当']))
    const mine = await (await fetch(`${base}/api/daily?date=2026-11-05&who=${encodeURIComponent('検証担当')}`)).json()
    expect(mine.text).not.toContain('基本設計レビュー')
  })

  test('文の中の WBS・課題の書き方と、画面での飛び先（links）を返す（文には URL を足さない）', async () => {
    const all = await (await fetch(`${base}/api/daily?date=2026-11-05`)).json()
    expect(all.links).toEqual(expect.arrayContaining([{ text: 'W-03', href: '#browse-W-03' }]))
    expect(all.text).not.toContain('#browse-')
    expect(all.tags).toEqual(expect.arrayContaining(['［済］', '［予定］']))
    // 担当で絞っていないときは、行の頭の担当名の書き方も返す（画面が札にする）。絞ると返さない
    expect(all.whoMarks).toEqual(expect.arrayContaining(['設計担当：']))
    const mine = await (await fetch(`${base}/api/daily?date=2026-11-05&who=${encodeURIComponent('設計担当')}`)).json()
    expect(mine.whoMarks).toEqual([])
  })

  test('日付の形がおかしければ 400', async () => {
    expect((await fetch(`${base}/api/daily?date=11-05`)).status).toBe(400)
  })
})

describe('1 日の進行を作る・足す・直す・消す', () => {
  const day = '2026-11-05'
  const send = (method: string, path: string, body?: unknown) =>
    fetch(`${base}${path}`, { method, headers: WRITE_HEADERS, ...(body ? { body: JSON.stringify(body) } : {}) })

  test('下書きを作ると日ごとのファイルに置き、行の ID が付く', async () => {
    const res = await send('POST', `/api/daily/${day}/generate`)
    expect(res.status).toBe(200)
    const daily = await (await fetch(`${base}/api/daily?date=${day}`)).json()
    expect(daily.saved).toBe(true)
    expect(daily.entries.length).toBeGreaterThan(0)
    expect(daily.entries[0].id).toMatch(/^a\d+$/)
  })

  test('足した行・直した行は、作り直しても残る。消した行は戻ってこない', async () => {
    const added = await (await send('POST', `/api/daily/${day}/entries`, { who: '検証担当', section: 'consult', text: '試験の環境はいつ空くか確かめたい' })).json()
    expect(added.entry.id).toMatch(/^m\d+$/)
    const before = await (await fetch(`${base}/api/daily?date=${day}`)).json()
    const target = before.entries.find((e: { origin: string }) => e.origin === 'auto')
    expect((await send('PUT', `/api/daily/${day}/entries/${target.id}`, { text: '観点表を半分まで書いた' })).status).toBe(200)
    const other = before.entries.find((e: { origin: string; id: string }) => e.origin === 'auto' && e.id !== target.id)
    if (other) expect((await send('DELETE', `/api/daily/${day}/entries/${other.id}`)).status).toBe(200)

    await send('POST', `/api/daily/${day}/generate`)
    const after = await (await fetch(`${base}/api/daily?date=${day}`)).json()
    expect(after.entries.find((e: { id: string }) => e.id === target.id)).toMatchObject({ text: '観点表を半分まで書いた', origin: 'edited' })
    expect(after.entries.find((e: { id: string }) => e.id === added.entry.id)?.text).toBe('試験の環境はいつ空くか確かめたい')
    if (other) expect(after.text).not.toContain(other.text)
    // 担当で絞っていないので、行の頭に担当名が付く
    expect(after.text).toMatch(/相談\n\d+\. (\S+：)?試験の環境はいつ空くか確かめたい/)
  })

  test('前の作業日の「次の作業日」に足した行は、次の作業日の「今日」に予定として出る（前の日の行は残る。今日に直せる）', async () => {
    const next = '2026-11-06'
    const key = (id: string) => `carry:${day}:${id}`
    const added = await (await send('POST', `/api/daily/${day}/entries`, { who: '設計担当', section: 'next', text: 'API の設計を始める' })).json()
    const carried = (await (await fetch(`${base}/api/daily?date=${next}`)).json()).entries.find((e: { text: string }) => e.text === 'API の設計を始める')
    expect(carried).toMatchObject({ section: 'today', origin: 'auto', tag: 'plan', key: key(added.entry.id) })
    // 前の日の行はそのまま
    const previous = (await (await fetch(`${base}/api/daily?date=${day}`)).json()).entries
    expect(previous.find((e: { id: string }) => e.id === added.entry.id)).toMatchObject({ section: 'next', origin: 'manual' })
    // 今日に置いて直すと、作り直しても直したまま
    await send('POST', `/api/daily/${next}/generate`)
    const saved = (await (await fetch(`${base}/api/daily?date=${next}`)).json()).entries.find((e: { key?: string }) => e.key === key(added.entry.id))
    expect((await send('PUT', `/api/daily/${next}/entries/${saved.id}`, { text: 'API の設計を半分まで' })).status).toBe(200)
    await send('POST', `/api/daily/${next}/generate`)
    const after = (await (await fetch(`${base}/api/daily?date=${next}`)).json()).entries.filter((e: { key?: string }) => e.key === key(added.entry.id))
    expect(after.map((e: { text: string }) => e.text)).toEqual(['API の設計を半分まで'])
  })

  test('おかしな見出し・長すぎる文・無い行は断る', async () => {
    expect((await send('POST', `/api/daily/${day}/entries`, { who: 'x', section: 'nope', text: 'a' })).status).toBe(400)
    expect((await send('POST', `/api/daily/${day}/entries`, { who: 'x', section: 'today', text: 'あ'.repeat(501) })).status).toBe(400)
    expect((await send('PUT', `/api/daily/${day}/entries/zz9`, { text: 'a' })).status).toBe(404)
  })

  test('x-tadori の無い書き込みは断る', async () => {
    expect((await fetch(`${base}/api/daily/${day}/generate`, { method: 'POST' })).status).toBe(403)
  })
})

describe('1 日の進行の行の印', () => {
  const day = '2026-11-06'
  const send = (method: string, path: string, body?: unknown) =>
    fetch(`${base}${path}`, { method, headers: WRITE_HEADERS, ...(body ? { body: JSON.stringify(body) } : {}) })

  test('足すときも直すときも印を付けられる。知らない印は断る', async () => {
    const added = await (await send('POST', `/api/daily/${day}/entries`, { who: 'x', section: 'today', text: '観点表を見直した', tag: 'done' })).json()
    expect(added.entry.tag).toBe('done')
    expect((await send('PUT', `/api/daily/${day}/entries/${added.entry.id}`, { tag: 'doing' })).status).toBe(200)
    const daily = await (await fetch(`${base}/api/daily?date=${day}`)).json()
    expect(daily.text).toMatch(/［作業中］(\S+：)?観点表を見直した/)
    expect((await send('PUT', `/api/daily/${day}/entries/${added.entry.id}`, { tag: 'nope' })).status).toBe(400)
  })
})

describe('GET /api/version・/api/update（ヘルプのバージョンと更新）', () => {
  test('手元で組んだ版（アプリの版が渡されていない）は、配った版と比べず、新しい版とも言わない', async () => {
    let asked = false
    const app = await startServer({ dir, port: 0, uiDir: null, checkUpdate: async current => { asked = true; return { current, latest: '9.9.9', isNewer: true, releaseUrl: '', downloadUrl: '' } } })
    const url = `http://127.0.0.1:${(app.address as { port: number }).port}`
    expect(await (await fetch(`${url}/api/update`)).json()).toMatchObject({ isNewer: false, isSourceBuild: true })
    expect(asked).toBe(false)
    await app.close()
  })

  test('いまの版と、新しい版があるかを返す。確かめられなければ 502 で理由を返す', async () => {
    const app = await startServer({
      dir, port: 0, uiDir: null, appVersion: '0.1.0',
      checkUpdate: async current => ({ current, latest: '0.2.0', isNewer: true, releaseUrl: 'https://github.com/meta-taro/tadori/releases/tag/v0.2.0', downloadUrl: 'https://meta-taro.github.io/tadori/download.html' }),
    })
    const url = `http://127.0.0.1:${(app.address as { port: number }).port}`
    expect(await (await fetch(`${url}/api/version`)).json()).toMatchObject({ version: '0.1.0', isStale: false })
    expect(await (await fetch(`${url}/api/update`)).json()).toMatchObject({ current: '0.1.0', latest: '0.2.0', isNewer: true })
    await app.close()

    const offline = await startServer({ dir, port: 0, uiDir: null, appVersion: '0.1.0', checkUpdate: async () => { throw new Error('新しい版があるか確かめられませんでした（offline）') } })
    const res = await fetch(`http://127.0.0.1:${(offline.address as { port: number }).port}/api/update`)
    expect(res.status).toBe(502)
    expect((await res.json()).error).toMatch(/確かめられません/)
    await offline.close()
  })
})

describe('ルールを画面から足す・直す・消す（/api/rules）', () => {
  const send = (method: string, path: string, body?: unknown) =>
    fetch(`${base}${path}`, { method, headers: WRITE_HEADERS, ...(body ? { body: JSON.stringify(body) } : {}) })

  test('足す・直す・消す。足したルールはすぐ判定に入る', async () => {
    const added = await send('POST', '/api/rules', { id: 'R40', phase: 'it', kind: 'filled', from: 'TC', field: 'verifier', label: '試験ケースに確かめる人がいる', owner: '検証担当' })
    expect(added.status).toBe(200)
    let state = await (await fetch(`${base}/api/state`)).json()
    expect(state.rules.find((r: { id: string }) => r.id === 'R40')).toMatchObject({ phase: 'it', kind: 'filled', owner: '検証担当' })
    expect((await send('PUT', '/api/rules/R40', { owner: '開発担当' })).status).toBe(200)
    state = await (await fetch(`${base}/api/state`)).json()
    expect(state.rules.find((r: { id: string }) => r.id === 'R40').owner).toBe('開発担当')
    expect((await send('DELETE', '/api/rules/R40')).status).toBe(200)
    state = await (await fetch(`${base}/api/state`)).json()
    expect(state.rules.some((r: { id: string }) => r.id === 'R40')).toBe(false)
  })

  test('知らない判定・同じ ID・無いルールは 400／404 で、理由を返す（ファイルは元のまま）', async () => {
    const bad = await send('POST', '/api/rules', { id: 'R41', phase: 'it', kind: 'nope', label: 'x' })
    expect(bad.status).toBe(400)
    expect((await bad.json()).problems.length).toBeGreaterThan(0)
    expect((await send('POST', '/api/rules', { id: 'R9', phase: 'it', kind: 'covered', label: 'x' })).status).toBe(400)
    expect((await send('DELETE', '/api/rules/R99')).status).toBe(400)
    expect((await fetch(`${base}/api/rules`, { method: 'POST', body: '{}' })).status).toBe(403) // x-tadori の無い書き込み
  })
})

describe('server の中の例外（画面に要点と記録の場所を出し、手元に残す）', () => {
  test('落ちたら 500 で例外の要点と記録のファイルを返し、記録を新しい順に読める', async () => {
    const logDir = await mkdtemp(join(tmpdir(), 'tadori-cli-log-'))
    const app = await startServer({ dir, port: 0, uiDir: null, logDir })
    const url = `http://127.0.0.1:${(app.address as { port: number }).port}`
    // 壊れた日ごとのファイル（見出しが知らない値）を読ませて落とす
    await mkdir(join(dir, '.tadori/daily'), { recursive: true })
    await writeFile(join(dir, '.tadori/daily/2026-01-05.tsv'), 'id\twho\tsection\ttext\twbs\tissue\tnote\torigin\tkey\nx\ta\tnope\tt\t\t\t\tauto\t\n', 'utf8')
    const res = await fetch(`${url}/api/daily?date=2026-01-05`)
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toMatch(/サーバーの中で問題が起きました：.*section/)
    expect(body.logFile).toMatch(/server-\d{4}-\d{2}-\d{2}\.log$/)
    const errors = await readServerErrors(logDir, 5)
    expect(errors[0]).toMatchObject({ method: 'GET', path: '/api/daily' })
    await app.close()
    await rm(join(dir, '.tadori/daily/2026-01-05.tsv'))
    await rm(logDir, { recursive: true, force: true })
  })
})
