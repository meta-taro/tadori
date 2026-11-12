import './i18n.js'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { checkUpdate, sourceBuildInfo, type UpdateInfo } from './update-check.js'
import { CLI_VERSION } from './version.js'
import { appendServerError, defaultLogDir } from './error-log.js'
import { readBuildInfo } from './build-info.js'
import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'
import { dirname, extname, join, normalize, resolve, sep } from 'node:path'
import {
  langOf, ProjectLoadError, removeRule, saveRule, saveSettings, saveTaskStatus, t, trace, validatePhases, validateStatuses, withLang, WriteRefused,
  type Lang, type Phase, type RuleInput, type StatusDef,
} from '@tadori/core'
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
  /** 画面に出す版（デスクトップアプリから起こしたときはアプリの版）。無ければ CLI の版 */
  readonly appVersion?: string
  /** 新しい版があるかを確かめる（テストでは差し替える）。既定は GitHub の公開リリースを見る */
  readonly checkUpdate?: (current: string) => Promise<UpdateInfo>
  /** server の中の例外を残す所。無ければ OS ごとの手元のログの場所 */
  readonly logDir?: string
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

const RULE_FIELDS = ['id', 'phase', 'kind', 'from', 'to', 'field', 'only', 'values', 'group', 'owner', 'label'] as const

/** 画面から届いたルールの項目（文字のものだけ受ける。渡されなかった項目は変えない） */
function ruleInputOf(body: unknown): Partial<RuleInput> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new HttpError(400, t('Send a JSON object'))
  const record = body as Record<string, unknown>
  return Object.fromEntries(RULE_FIELDS.flatMap(k => (typeof record[k] === 'string' ? [[k, (record[k] as string).replace(/[\t\r\n]+/g, ' ').trim()]] : [])))
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
    if (size > MAX_BODY_BYTES) throw new HttpError(413, t('The request body is too large'))
    chunks.push(chunk as Buffer)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new HttpError(400, t('Could not read it as JSON'))
  }
}

/**
 * 書き込みは、tadori の画面（と MCP）からだけ受ける。
 * 独自ヘッダを要求すると、ほかのサイトのページからは事前確認なしに送れないので、
 * ブラウザ経由で手元のサーバーへ書き込ませる攻撃（CSRF）を防げる。
 */
function assertWriteAllowed(req: IncomingMessage): void {
  if (req.headers['x-tadori'] !== '1') throw new HttpError(403, t('This write did not come from the tadori screen'))
  // Origin が付いているなら、このサーバー自身でなければ断る
  const origin = req.headers.origin
  if (origin !== undefined && origin !== `http://${req.headers.host}`) throw new HttpError(403, t('Writes from other sites are not accepted'))
  if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) throw new HttpError(415, t('Send it as JSON'))
}

/**
 * Host が手元（127.0.0.1 / localhost）でなければ断る。
 * DNS を差し替えて、ほかのサイトのページから手元のサーバーを同じ出どころとして読ませる攻撃（DNS rebinding）を防ぐ。
 */
function assertLocalHost(req: IncomingMessage, port: number): void {
  const allowed = [`127.0.0.1:${port}`, `localhost:${port}`]
  if (!allowed.includes(String(req.headers.host ?? ''))) throw new HttpError(403, t('Only calls from this machine (127.0.0.1) are accepted'))
}

/**
 * この頼みの言語：画面が付ける x-tadori-lang（画面で選んだ言語）→ Accept-Language → 無ければ undefined（処理の既定の言語）。
 * 画面は同じ出どころから呼ぶので、x-tadori-lang のために CORS の許可を足す必要はない
 */
export function requestLang(req: IncomingMessage): Lang | undefined {
  const chosen = langOf(String(req.headers['x-tadori-lang'] ?? ''))
  if (chosen) return chosen
  // Accept-Language は「ja,en;q=0.9」の形。書かれた順に見て、tadori が知っている最初の言語を使う
  for (const part of String(req.headers['accept-language'] ?? '').split(',')) {
    const lang = langOf(part.split(';')[0])
    if (lang) return lang
  }
  return undefined
}

/** 壊れた % の書き方は 400 にする（サーバーの中の問題として扱わない） */
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    throw new HttpError(400, t('The URL is malformed'))
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
  if (!Array.isArray(body)) throw new HttpError(400, t('Send an array of phases'))
  return body.map((p, i) => {
    if (!p || !isString(p.id) || !isString(p.name) || typeof p.order !== 'number') {
      throw new HttpError(400, t('Phase {no} has the wrong shape (id, name and order are required)', { no: i + 1 }))
    }
    return { id: p.id.trim(), name: p.name.trim(), order: p.order }
  })
}

const TONES = ['none', 'wait', 'hole', 'ok'] as const
function parseStatuses(body: unknown): StatusDef[] {
  if (!Array.isArray(body)) throw new HttpError(400, t('Send an array of statuses'))
  return body.map((s, i) => {
    if (!s || !isString(s.id) || !isString(s.name) || !TONES.includes(s.tone)) {
      throw new HttpError(400, t('Status {no} has the wrong shape (id, name and tone are required)', { no: i + 1 }))
    }
    return { id: s.id.trim(), name: s.name.trim(), tone: s.tone as StatusDef['tone'] }
  })
}

async function serveStatic(uiDir: string, urlPath: string, res: ServerResponse): Promise<void> {
  const root = resolve(uiDir)
  const wanted = urlPath === '/' ? '/index.html' : urlPath
  const file = normalize(join(root, safeDecode(wanted)))
  // 画面のフォルダの外は出さない
  if (file !== root && !file.startsWith(root + sep)) throw new HttpError(404, t('Not found'))
  try {
    const body = await readFile(file)
    res.writeHead(200, { ...STATIC_HEADERS, 'content-type': CONTENT_TYPES[extname(file)] ?? 'application/octet-stream' })
    res.end(body)
  } catch {
    throw new HttpError(404, t('Not found'))
  }
}

/** 前の書き込みが終わるのを待つ上限。過ぎたら待たせ続けず「いま別の書き込みをしています」と返す */
const BUSY_WAIT_MS = 4_000

/**
 * 書き込みを 1 本の列に並べる。読み込み → 検査 → 書き込み → commit の途中に別の書き込みが割り込むと、
 * 片方の変更が失われたり、git の index がぶつかったりするため。
 * 1 台の PC で何人もの席がこの server を共有するので、前の書き込みが長引いても（commit 前の検査が遅い案件など）
 * 後ろを黙って待たせ続けない。待つのは BUSY_WAIT_MS までで、それを過ぎたら何もせずに 409 で返す（読む呼び出しは並ばない）
 */
let writeChain: Promise<unknown> = Promise.resolve()
let writingSince: number | null = null
function serialized<T>(work: () => Promise<T>): Promise<T> {
  let started = false
  let gaveUp = false
  const run = writeChain.then(async () => {
    if (gaveUp) return undefined
    started = true
    writingSince = Date.now()
    try {
      return await work()
    } finally {
      writingSince = null
    }
  })
  writeChain = run.catch(() => undefined) // 失敗しても、次の書き込みは続ける
  const busy = new Promise<never>((_, reject) => {
    const timer = setTimeout(() => {
      if (started) return // 自分の番が来て書いている途中なら、終わるまで待つ
      gaveUp = true
      const seconds = writingSince === null ? 0 : Math.round((Date.now() - writingSince) / 1000)
      reject(new HttpError(409, t('Another write is being saved in this project ({seconds} seconds so far). Nothing was changed. Try again in a moment', { seconds })))
    }, BUSY_WAIT_MS)
    timer.unref()
    void run.finally(() => clearTimeout(timer)).catch(() => undefined)
  })
  return Promise.race([run as Promise<T>, busy])
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
    if (!screens) throw new HttpError(409, t('No tadori screen is open. Open the screen, then send again'))
    return sendJson(res, 200, { screens })
  }

  if (req.method === 'GET' && url.pathname === '/api/daily') {
    // 人単位の 1 日の進行
    const date = url.searchParams.get('date') || today
    if (!isDay(date)) throw new HttpError(400, t('Give the date as YYYY-MM-DD'))
    const who = url.searchParams.get('who')?.trim()
    // read=1：読み上げの文（課題ごとの要約があれば、その課題の今日の細かい行の代わりに要約を出す）
    return sendJson(res, 200, await loadDaily(dir, date, who || undefined, { read: url.searchParams.get('read') === '1' }))
  }

  // 1 日の進行を作る・足す・直す・消す（日ごとのファイルに書き、git リポジトリなら commit）
  const dailyMatch = url.pathname.match(/^\/api\/daily\/(\d{4}-\d{2}-\d{2})\/(generate|entries)(?:\/([A-Za-z0-9_-]{1,32}))?$/)
  if (dailyMatch) {
    assertWriteAllowed(req)
    const [, date = '', what, id] = dailyMatch
    if (!isDay(date)) throw new HttpError(400, t('Give the date as YYYY-MM-DD'))
    const work = async () => {
      if (req.method === 'POST' && what === 'generate' && !id) return { commit: await generateDaily(dir, date) }
      if (req.method === 'POST' && what === 'entries' && !id) return addDaily(dir, date, await readJson(req))
      if (req.method === 'PUT' && what === 'entries' && id) return updateDaily(dir, date, id, await readJson(req))
      if (req.method === 'DELETE' && what === 'entries' && id) return removeDaily(dir, date, id)
      throw new HttpError(404, t('No such operation'))
    }
    try {
      return sendJson(res, 200, await serialized(work))
    } catch (error: unknown) {
      if (error instanceof DailyInputError) throw new HttpError(error.status, error.message)
      throw error
    }
  }

  // ヘルプの「バージョンと更新」。見に行くのは GitHub の公開リリースだけで、案件の中身は送らない
  if (req.method === 'GET' && url.pathname === '/api/version') {
    // 建てた時刻と commit、元のコードより古くないか（古ければ画面が知らせる）
    const here = dirname(fileURLToPath(import.meta.url))
    const build = await readBuildInfo(here, [resolve(here, '../src'), resolve(here, '../../core/src')])
    return sendJson(res, 200, { version: options.appVersion ?? CLI_VERSION, ...build })
  }
  if (req.method === 'GET' && url.pathname === '/api/update') {
    try {
      // アプリの版が渡されていない＝手元でソースから組んだ版。配った版の番号とは比べられないので、見に行かない
      if (!options.appVersion) return sendJson(res, 200, sourceBuildInfo(CLI_VERSION))
      return sendJson(res, 200, await (options.checkUpdate ?? checkUpdate)(options.appVersion))
    } catch (error: unknown) {
      throw new HttpError(502, error instanceof Error ? error.message : String(error))
    }
  }

  if (req.method === 'GET' && url.pathname === '/api/state') {
    return sendJson(res, 200, (await loadState(dir, today)).state)
  }

  const traceMatch = url.pathname.match(/^\/api\/trace\/([^/]+)$/)
  if (req.method === 'GET' && traceMatch) {
    const { project } = await loadState(dir, today)
    const result = trace(project, safeDecode(traceMatch[1] ?? ''))
    if (!result) throw new HttpError(404, t('That ID is not in the ledger'))
    return sendJson(res, 200, result)
  }

  // ルールを画面から足す・直す・消す（形と ID は核が確かめる。読めなくなる書き方は元に戻して断る）
  const ruleMatch = url.pathname.match(/^\/api\/rules(?:\/([^/]+))?$/)
  if (ruleMatch && ['POST', 'PUT', 'DELETE'].includes(req.method ?? '')) {
    assertWriteAllowed(req)
    const id = ruleMatch[1] ? safeDecode(ruleMatch[1]) : undefined
    const body = req.method === 'DELETE' ? {} : ruleInputOf(await readJson(req))
    try {
      const commit = await serialized(() => {
        if (req.method === 'POST' && !id) return saveRule(dir, body as RuleInput, { create: true })
        if (req.method === 'PUT' && id) return saveRule(dir, { ...body, id }, { create: false })
        if (req.method === 'DELETE' && id) return removeRule(dir, id)
        throw new HttpError(404, t('Put the rule ID in the URL (to add one, POST to /api/rules)'))
      })
      return sendJson(res, 200, { commit })
    } catch (error: unknown) {
      if (error instanceof WriteRefused) throw new HttpError(400, t('Could not save the rule'), [...error.problems])
      throw error
    }
  }

  if (req.method === 'PUT' && url.pathname === '/api/settings/phases') {
    assertWriteAllowed(req)
    const next = parsePhases(await readJson(req))
    const commit = await serialized(async () => {
      const { project } = await loadState(dir, today)
      const problems = validatePhases(project, next)
      if (problems.length) throw new HttpError(400, t('Could not save the phase settings'), problems)
      return saveSettings(dir, { phases: next }, t('Change the phase settings'))
    })
    return sendJson(res, 200, { commit })
  }

  if (req.method === 'PUT' && url.pathname === '/api/settings/statuses') {
    assertWriteAllowed(req)
    const next = parseStatuses(await readJson(req))
    const commit = await serialized(async () => {
      const { project } = await loadState(dir, today)
      const problems = validateStatuses(project, next)
      if (problems.length) throw new HttpError(400, t('Could not save the status settings'), problems)
      return saveSettings(dir, { statuses: next }, t('Change the status settings'))
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
        throw new HttpError(400, t('That status is not in the settings'))
      }
      const result = await saveTaskStatus(dir, taskId, body.status)
      if (!result) throw new HttpError(404, t('That task is not in the WBS'))
      return result
    })
    return sendJson(res, 200, { commit })
  }

  if (req.method === 'GET' && options.uiDir && !url.pathname.startsWith('/api/')) {
    return serveStatic(options.uiDir, url.pathname, res)
  }
  throw new HttpError(404, t('Not found'))
}

/**
 * 例外を手元の記録に残し、そのファイルの場所を返す（画面に出す）。残せなくても、画面への返事は止めない
 */
async function reportCrash(options: ServerOptions, req: IncomingMessage, error: unknown): Promise<string | null> {
  try {
    const path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname
    return await appendServerError(options.logDir ?? defaultLogDir(), { method: req.method ?? '', path, project: options.dir, error })
  } catch (logError: unknown) {
    process.stderr.write(`${t('tadori serve: could not log the error: {reason}', { reason: logError instanceof Error ? logError.message : String(logError) })}
`)
    return null
  }
}

/** 手元だけで動くサーバーを立てる。127.0.0.1 にだけつなぐ（同じ網のほかの PC からは見えない） */
export async function startServer(options: ServerOptions): Promise<RunningServer> {
  // 実際につないだ番号（--port 0 のときは OS が決める）。Host の検査に使う
  let boundPort = options.port
  // ほかのアプリ（md-business など）や git pull で TSV が書き換わったら、画面へ知らせる
  const notifier = watchProject(options.dir)
  // 1 回の頼みごとは、その頼みの言語で返す（画面で選んだ言語。誤りの文も同じ言語にする）
  const server = createServer((req, res) => withLang(requestLang(req), () => {
    route(options, boundPort, notifier, req, res).catch((error: unknown) => {
      if (error instanceof HttpError) return sendJson(res, error.status, { error: error.message, problems: error.problems })
      if (error instanceof ProjectLoadError) return sendJson(res, 422, { error: t('Could not read the project'), problems: error.problems })
      process.stderr.write(`tadori serve: ${error instanceof Error ? error.stack : String(error)}\n`)
      // 画面には例外の要点と、手元に残した記録の場所を出す（エージェントは MCP の server_errors で読める）
      return reportCrash(options, req, error).then(logFile => sendJson(res, 500, {
        error: t('Something went wrong inside the server: {reason}', { reason: error instanceof Error ? error.message : String(error) }),
        ...(logFile ? { logFile } : {}),
      }))
    })
  }))
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
