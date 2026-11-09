import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { ProjectLoadError, saveSettings, saveTaskStatus, trace, validatePhases, validateStatuses, type Phase, type StatusDef } from '@tadori/core'
import { loadState, localToday } from './state.js'
import { watchProject, type ChangeNotifier } from './watch.js'
import { AgentActionError, parseAgentAction } from './agent.js'
import { addDaily, DailyInputError, generateDaily, isDay, loadDaily, removeDaily, updateDaily } from './daily.js'

export interface ServerOptions {
  readonly dir: string
  readonly port: number
  /** 今日（YYYY-MM-DD）。渡さなければ、読むたびにその日の日付を使う（開きっぱなしでも日付がずれない） */
  readonly today?: string
  /** 画面のファイルの置き場所。null なら API だけ */
  readonly uiDir: string | null
}

export interface RunningServer {
  readonly address: ReturnType<Server['address']>
  close(): Promise<void>
}

const MAX_BODY_BYTES = 256 * 1024
const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.tsv': 'text/tab-separated-values; charset=utf-8',
}

class HttpError extends Error {
  constructor(readonly status: number, message: string, readonly problems: readonly string[] = []) {
    super(message)
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > MAX_BODY_BYTES) throw new HttpError(413, '送られた内容が大きすぎます')
    chunks.push(chunk as Buffer)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new HttpError(400, 'JSON として読めませんでした')
  }
}

/**
 * 書き込みは、tadori の画面（と MCP）からだけ受ける。
 * 独自ヘッダを要求すると、ほかのサイトのページからは事前確認なしに送れないので、
 * ブラウザ経由で手元のサーバーへ書き込ませる攻撃（CSRF）を防げる。
 */
function assertWriteAllowed(req: IncomingMessage): void {
  if (req.headers['x-tadori'] !== '1') throw new HttpError(403, 'tadori の画面からの書き込みではありません')
  // Origin が付いているなら、このサーバー自身でなければ断る
  const origin = req.headers.origin
  if (origin !== undefined && origin !== `http://${req.headers.host}`) throw new HttpError(403, 'ほかのサイトからの書き込みは受けません')
  if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) throw new HttpError(415, 'JSON で送ってください')
}

/**
 * Host が手元（127.0.0.1 / localhost）でなければ断る。
 * DNS を差し替えて、ほかのサイトのページから手元のサーバーを同じ出どころとして読ませる攻撃（DNS rebinding）を防ぐ。
 */
function assertLocalHost(req: IncomingMessage, port: number): void {
  const allowed = [`127.0.0.1:${port}`, `localhost:${port}`]
  if (!allowed.includes(String(req.headers.host ?? ''))) throw new HttpError(403, '手元（127.0.0.1）以外からの呼び出しは受けません')
}

/** 壊れた % の書き方は 400 にする（サーバーの中の問題として扱わない） */
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    throw new HttpError(400, 'URL の書き方が正しくありません')
  }
}

/** 画面のファイルに付ける。外のスクリプトを読ませず、ファイルの種類を推測させない */
const STATIC_HEADERS = {
  'content-security-policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'cache-control': 'no-store',
}

// ---- 入力の検査（外から来た値は信用しない） ----
const isString = (v: unknown): v is string => typeof v === 'string'

function parsePhases(body: unknown): Phase[] {
  if (!Array.isArray(body)) throw new HttpError(400, '工程の配列を送ってください')
  return body.map((p, i) => {
    if (!p || !isString(p.id) || !isString(p.name) || typeof p.order !== 'number') {
      throw new HttpError(400, `${i + 1} 番目の工程の形が違います（id・name・order が要ります）`)
    }
    return { id: p.id.trim(), name: p.name.trim(), order: p.order }
  })
}

const TONES = ['none', 'wait', 'hole', 'ok'] as const
function parseStatuses(body: unknown): StatusDef[] {
  if (!Array.isArray(body)) throw new HttpError(400, 'ステータスの配列を送ってください')
  return body.map((s, i) => {
    if (!s || !isString(s.id) || !isString(s.name) || !TONES.includes(s.tone)) {
      throw new HttpError(400, `${i + 1} 番目のステータスの形が違います（id・name・tone が要ります）`)
    }
    return { id: s.id.trim(), name: s.name.trim(), tone: s.tone as StatusDef['tone'] }
  })
}

async function serveStatic(uiDir: string, urlPath: string, res: ServerResponse): Promise<void> {
  const root = resolve(uiDir)
  const wanted = urlPath === '/' ? '/index.html' : urlPath
  const file = normalize(join(root, safeDecode(wanted)))
  // 画面のフォルダの外は出さない
  if (file !== root && !file.startsWith(root + sep)) throw new HttpError(404, '見つかりません')
  try {
    const body = await readFile(file)
    res.writeHead(200, { ...STATIC_HEADERS, 'content-type': CONTENT_TYPES[extname(file)] ?? 'application/octet-stream' })
    res.end(body)
  } catch {
    throw new HttpError(404, '見つかりません')
  }
}

/**
 * 書き込みを 1 本の列に並べる。読み込み → 検査 → 書き込み → commit の途中に別の書き込みが割り込むと、
 * 片方の変更が失われたり、git の index がぶつかったりするため。手元の道具なので、同時に来る書き込みは少ない。
 */
let writeChain: Promise<unknown> = Promise.resolve()
function serialized<T>(work: () => Promise<T>): Promise<T> {
  const run = writeChain.then(work, work)
  writeChain = run.catch(() => undefined) // 失敗しても、次の書き込みは続ける
  return run
}

async function route(options: ServerOptions, port: number, notifier: ChangeNotifier, req: IncomingMessage, res: ServerResponse): Promise<void> {
  assertLocalHost(req, port)
  const url = new URL(req.url ?? '/', 'http://localhost')
  const { dir } = options
  const today = options.today ?? localToday()

  if (req.method === 'GET' && url.pathname === '/api/events') {
    notifier.attach(res)
    return
  }

  if (req.method === 'POST' && url.pathname === '/api/agent') {
    // エージェントの専用カーソル：人のマウスを使わず、画面の中で指す・押す・打つ
    assertWriteAllowed(req)
    let action
    try {
      action = parseAgentAction(await readJson(req))
    } catch (error: unknown) {
      if (error instanceof AgentActionError) throw new HttpError(400, error.message)
      throw error
    }
    const screens = notifier.send('agent', action)
    if (!screens) throw new HttpError(409, 'tadori の画面が開いていません。画面を開いてから送ってください')
    return sendJson(res, 200, { screens })
  }

  if (req.method === 'GET' && url.pathname === '/api/daily') {
    // 人単位の 1 日の進行
    const date = url.searchParams.get('date') || today
    if (!isDay(date)) throw new HttpError(400, '日付は YYYY-MM-DD で渡してください')
    const who = url.searchParams.get('who')?.trim()
    return sendJson(res, 200, await loadDaily(dir, date, who || undefined))
  }

  // 1 日の進行を作る・足す・直す・消す（日ごとのファイルに書き、git リポジトリなら commit）
  const dailyMatch = url.pathname.match(/^\/api\/daily\/(\d{4}-\d{2}-\d{2})\/(generate|entries)(?:\/([A-Za-z0-9_-]{1,32}))?$/)
  if (dailyMatch) {
    assertWriteAllowed(req)
    const [, date = '', what, id] = dailyMatch
    if (!isDay(date)) throw new HttpError(400, '日付は YYYY-MM-DD で渡してください')
    const work = async () => {
      if (req.method === 'POST' && what === 'generate' && !id) return { commit: await generateDaily(dir, date) }
      if (req.method === 'POST' && what === 'entries' && !id) return addDaily(dir, date, await readJson(req))
      if (req.method === 'PUT' && what === 'entries' && id) return updateDaily(dir, date, id, await readJson(req))
      if (req.method === 'DELETE' && what === 'entries' && id) return removeDaily(dir, date, id)
      throw new HttpError(404, 'その操作はありません')
    }
    try {
      return sendJson(res, 200, await serialized(work))
    } catch (error: unknown) {
      if (error instanceof DailyInputError) throw new HttpError(error.status, error.message)
      throw error
    }
  }

  if (req.method === 'GET' && url.pathname === '/api/state') {
    return sendJson(res, 200, (await loadState(dir, today)).state)
  }

  const traceMatch = url.pathname.match(/^\/api\/trace\/([^/]+)$/)
  if (req.method === 'GET' && traceMatch) {
    const { project } = await loadState(dir, today)
    const result = trace(project, safeDecode(traceMatch[1] ?? ''))
    if (!result) throw new HttpError(404, 'その ID は台帳にありません')
    return sendJson(res, 200, result)
  }

  if (req.method === 'PUT' && url.pathname === '/api/settings/phases') {
    assertWriteAllowed(req)
    const next = parsePhases(await readJson(req))
    const commit = await serialized(async () => {
      const { project } = await loadState(dir, today)
      const problems = validatePhases(project, next)
      if (problems.length) throw new HttpError(400, '工程の設定を保存できません', problems)
      return saveSettings(dir, { phases: next }, '工程の設定を変更')
    })
    return sendJson(res, 200, { commit })
  }

  if (req.method === 'PUT' && url.pathname === '/api/settings/statuses') {
    assertWriteAllowed(req)
    const next = parseStatuses(await readJson(req))
    const commit = await serialized(async () => {
      const { project } = await loadState(dir, today)
      const problems = validateStatuses(project, next)
      if (problems.length) throw new HttpError(400, 'ステータスの設定を保存できません', problems)
      return saveSettings(dir, { statuses: next }, 'ステータスの設定を変更')
    })
    return sendJson(res, 200, { commit })
  }

  const statusMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/status$/)
  if (req.method === 'PUT' && statusMatch) {
    assertWriteAllowed(req)
    const body = await readJson(req) as { status?: unknown }
    const taskId = safeDecode(statusMatch[1] ?? '')
    const commit = await serialized(async () => {
      const { project } = await loadState(dir, today)
      if (!isString(body?.status) || !project.statuses.some(s => s.id === body.status)) {
        throw new HttpError(400, '設定に無いステータスです')
      }
      const result = await saveTaskStatus(dir, taskId, body.status)
      if (!result) throw new HttpError(404, 'そのタスクは WBS にありません')
      return result
    })
    return sendJson(res, 200, { commit })
  }

  if (req.method === 'GET' && options.uiDir && !url.pathname.startsWith('/api/')) {
    return serveStatic(options.uiDir, url.pathname, res)
  }
  throw new HttpError(404, '見つかりません')
}

/** 手元だけで動くサーバーを立てる。127.0.0.1 にだけつなぐ（同じ網のほかの PC からは見えない） */
export async function startServer(options: ServerOptions): Promise<RunningServer> {
  // 実際につないだ番号（--port 0 のときは OS が決める）。Host の検査に使う
  let boundPort = options.port
  // ほかのアプリ（md-business など）や git pull で TSV が書き換わったら、画面へ知らせる
  const notifier = watchProject(options.dir)
  const server = createServer((req, res) => {
    route(options, boundPort, notifier, req, res).catch((error: unknown) => {
      if (error instanceof HttpError) return sendJson(res, error.status, { error: error.message, problems: error.problems })
      if (error instanceof ProjectLoadError) return sendJson(res, 422, { error: '案件を読めませんでした', problems: error.problems })
      process.stderr.write(`tadori serve: ${error instanceof Error ? error.stack : String(error)}\n`)
      return sendJson(res, 500, { error: 'サーバーの中で問題が起きました。ターミナルの表示を見てください' })
    })
  })
  await new Promise<void>(done => server.listen(options.port, '127.0.0.1', done))
  const address = server.address()
  if (address && typeof address === 'object') boundPort = address.port
  return {
    address: server.address(),
    close: () => {
      notifier.close() // 開いている知らせの接続を先に閉じる（閉じないとサーバーが止まりきらない）
      return new Promise<void>((done, fail) => server.close(err => (err ? fail(err) : done())))
    },
  }
}
