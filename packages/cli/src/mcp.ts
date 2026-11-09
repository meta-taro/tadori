import { readFile } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { parseTsv, trace } from '@tadori/core'
import { formatCheck, formatTrace, originText } from './format.js'
import { howTo } from './guide.js'
import { writeTools, type WriteContext } from './mcp-write.js'
import { addDaily, DailyInputError, generateDaily, isDay, loadDaily, removeDaily, updateDaily } from './daily.js'
import { loadState, localToday } from './state.js'
import { defaultLogDir, readServerErrors } from './error-log.js'

/**
 * tadori の MCP の口（標準入出力・1 行 1 つの JSON-RPC）。
 * 画面でできることを順に足していく。人の承認には口を作らない（承認するのは人だけ）。
 */

const PROTOCOL_VERSION = '2025-06-18'

interface JsonRpcMessage {
  readonly jsonrpc: '2.0'
  readonly id?: string | number
  readonly method?: string
  readonly params?: unknown
}

type JsonRpcResponse =
  | { jsonrpc: '2.0'; id: string | number; result: unknown }
  | { jsonrpc: '2.0'; id: string | number | null; error: { code: number; message: string } }

interface ToolResult {
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
}

interface Tool {
  readonly name: string
  readonly description: string
  readonly inputSchema: Record<string, unknown>
  run(args: Record<string, unknown>): Promise<ToolResult>
}

export interface McpOptions {
  /** 用語集の正本（packages/ui/static/glossary.tsv）。画面の「用語」と同じものを読む */
  readonly glossaryPath: string
  readonly version: string
  /** 案件のフォルダ。無ければ、案件を読む道具は断る */
  readonly projectDir?: string
  /** 今日（YYYY-MM-DD）。遅れの日数に使う */
  readonly today?: string
  /** 使い方（packages/cli/guide.md）。## <話題> ごとに how_to で返す */
  readonly guidePath?: string
  /** 専用カーソルで操作する画面（tadori serve）の場所。既定はデスクトップアプリの http://127.0.0.1:4873 */
  readonly screenUrl?: string
  /** server の例外の記録の場所（server_errors が読む）。無ければ OS ごとの手元のログの場所 */
  readonly logDir?: string
}

/** デスクトップアプリが開く番号（packages/desktop の PREFERRED_PORT と同じ） */
export const DEFAULT_SCREEN_URL = 'http://127.0.0.1:4873'

const MAX_FOUND = 30

const text = (body: string, isError = false): ToolResult => ({ content: [{ type: 'text', text: body }], ...(isError ? { isError } : {}) })

/** 用語集を読み、言葉で絞って Markdown にする */
async function glossaryText(path: string, query: string): Promise<string> {
  const entries = parseTsv(await readFile(path, 'utf8')).rows
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const shown = entries.filter(e => words.every(w => `${e.term} ${e.meaning} ${e.example}`.toLowerCase().includes(w)))
  if (!shown.length) return `「${query}」に合う言葉がありません。query を空にすると、全部の言葉を返します。`
  const groups = [...new Set(shown.map(e => e.group ?? ''))]
  return groups.map(group => [
    `## ${group}`,
    ...shown.filter(e => e.group === group).map(e =>
      `- **${e.term}**：${e.meaning}${e.where ? `（画面：${e.where}）` : ''}${e.example ? `　例：${e.example}` : ''}`),
  ].join('\n')).join('\n\n')
}

/** 案件を読む道具。画面・CLI と同じ判定の核を通す（MCP だけの判定を作らない） */
function buildProjectTools(options: McpOptions): Tool[] {
  const withState = async <T>(use: (loaded: Awaited<ReturnType<typeof loadState>>) => T): Promise<T | ToolResult> => {
    if (!options.projectDir) return text('案件のフォルダを指定して起動してください（例：tadori mcp examples/lend-v12）', true)
    return use(await loadState(options.projectDir, options.today ?? localToday()))
  }
  const str = (v: unknown) => (typeof v === 'string' ? v : '')
  return [
    {
      name: 'get_remaining',
      description: '工程ごとの残課題（漏れと人の承認待ち）・遅れた日数・前の完了判定より前に着手しているかを返す。画面の「リリースまでの残課題」と同じ中身。割合や点数は出さない。',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      run: async () => withState(({ state }) => text(formatCheck(state))),
    },
    {
      name: 'list_leaks',
      description: '漏れ（ルールが求めるつながりや列が無い所）の一覧を返す。phase に工程の ID（例：dd）を渡すと、その工程のルールの漏れだけにする。',
      inputSchema: { type: 'object', properties: { phase: { type: 'string', description: '工程の ID（例：bd・dd・it）。空なら全部' } }, additionalProperties: false },
      run: async args => withState(({ state }) => {
        const phase = str(args.phase)
        const ruleIds = new Set(state.rules.filter(r => !phase || r.phase === phase).map(r => r.id))
        const leaks = state.leaks.filter(l => !phase || ruleIds.has(l.rule))
        // 漏れごとに、担当と、どこをどう直せば消えるかを添える（エージェントが人に伝えやすいように）
        const lines = leaks.map(l => `- ${l.rule}·${l.itemId} ${l.message}${l.fix ? `\n  ${l.owner ? `担当：${l.owner}　` : ''}直し方：${l.fix}` : ''}`)
        return text(lines.length ? lines.join('\n') : '漏れはありません')
      }),
    },
    {
      name: 'trace',
      description: '台帳の 1 行（指摘・試験ケース・設計書の章など）から上流と下流のつながりを辿り、切れている所（✗）を返す。つながりは台帳の ID だけで判定し、推測でつながない。'
        + '「確かにそこが漏れていた」と認めるのは人なので、結果は人に見せて判断してもらうこと。',
      inputSchema: { type: 'object', properties: { id: { type: 'string', description: '辿り始めの行の ID（例：F-02）' } }, required: ['id'], additionalProperties: false },
      run: async args => withState(({ project, state }) => {
        const result = trace(project, str(args.id))
        return result ? text(formatTrace(result, state.origins)) : text(`${str(args.id)} は台帳にありません。find_items で探してください`, true)
      }),
    },
    {
      name: 'find_items',
      description: '台帳の行を ID か名前で探す（空白で区切ると、全部を含むもの）。trace に渡す ID を見つけるのに使う。',
      inputSchema: { type: 'object', properties: { query: { type: 'string', description: '探す言葉（例：延滞、TC-07）' } }, required: ['query'], additionalProperties: false },
      run: async args => withState(({ state }) => {
        const words = str(args.query).trim().toLowerCase().split(/\s+/).filter(Boolean)
        const found = state.items.filter(i => words.every(w => `${i.id} ${i.title}`.toLowerCase().includes(w)))
        if (!found.length) return text(`「${str(args.query)}」に合う行がありません`)
        const lines = found.slice(0, MAX_FOUND).map(i => {
          const origin = state.origins[i.id]
          return `- ${i.id}（${state.labels.kinds[i.kind] ?? i.kind}）${i.title}${origin ? `\n  ${originText(origin)}` : ''}`
        })
        if (found.length > MAX_FOUND) lines.push(`ほか ${found.length - MAX_FOUND} 件。言葉を足して絞ってください`)
        return text(lines.join('\n'))
      }),
    },
    ...dailyTools(options),
  ]
}

/** 1 日の進行の道具：読む・作る・足す・直す・消す。人の承認には関わらない（1 日の進行は人とエージェントが書く記録） */
function dailyTools(options: McpOptions): Tool[] {
  const str = (v: unknown) => (typeof v === 'string' ? v : '')
  const SECTION = { type: 'string', enum: ['today', 'next', 'consult', 'upkeep'], description: 'today＝今日 / next＝次の作業日 / consult＝相談 / upkeep＝台帳の整備（成果物の作業ではないもの）' }
  const DATE = { type: 'string', description: '日付（YYYY-MM-DD）。空なら今日' }
  const ENTRY_FIELDS = {
    who: { type: 'string', description: '担当（2 人以上は「A・B」）' },
    text: { type: 'string', description: '本文（番号と末尾の WBS は付けない。場所や URL は補足へ）' },
    wbs: { type: 'array', items: { type: 'string' }, description: 'つながる WBS の ID（例：W-03）' },
    links: {
      type: 'array', maxItems: 8,
      items: { type: 'object', properties: { label: { type: 'string', description: '表示名（例：QA表・MR・設計書 3.2.5）' }, url: { type: 'string', description: 'http か https の URL' }, anchor: { type: 'string', description: '本文の中の語。画面ではその語をリンクにする（行末には出さない）。本文に無ければ行末に「表示名 ↗」で出す' }, nth: { type: 'number', description: '同じ語が何回も出るとき、何回目か（既定 1）' } }, required: ['label', 'url'], additionalProperties: false },
      description: 'その作業でさわった正本の場所。画面では行の末尾に「表示名 ↗」で出て押すと開く。読み上げる文には入れず、補足に出す。直すときは全件を渡し直す',
    },
    issue: { type: 'string', description: '課題の ID（台帳の行）' },
    note: { type: 'string', description: '補足に足す一言（聞かれたら読むもの）' },
    tag: { type: 'string', enum: ['', 'done', 'doing', 'plan', 'upkeep', 'checked'], description: '行の印：done＝やり終えた / doing＝作業中 / plan＝予定 / upkeep＝台帳の整備 / checked＝確かめた（空なら印なし）' },
  }
  /** 案件・日付を確かめてから、本体を動かす。入力の誤りは isError で返す */
  const withDay = async (args: Record<string, unknown>, work: (dir: string, date: string) => Promise<ToolResult>): Promise<ToolResult> => {
    if (!options.projectDir) return text('案件のフォルダを指定して起動してください（例：tadori mcp examples/lend-v12）', true)
    const date = str(args.date).trim() || (options.today ?? localToday())
    if (!isDay(date)) return text('date は YYYY-MM-DD で渡してください', true)
    try {
      return await work(options.projectDir, date)
    } catch (error: unknown) {
      if (error instanceof DailyInputError) return text(error.message, true)
      throw error
    }
  }
  const committed = (c: { committed: boolean; reason?: string }) => (c.committed ? 'commit しました（push は人）' : (c.reason ?? ''))
  return [
    {
      name: 'daily',
      description: '人単位の「1 日の進行」を返す（今日・次の作業日・相談・補足）と、行の一覧（[ID] 付き）。who に担当を渡すと、その人の分だけ。'
        + '材料（WBS の状態の変化・台帳の差分・チェックの記録）から作った下書きと、人やエージェントが直した行を合わせたもの。'
        + '文を直す・相談を書くのは daily_update / daily_add で。',
      inputSchema: { type: 'object', properties: { who: { type: 'string', description: '担当。空なら全員' }, date: DATE }, additionalProperties: false },
      run: async args => withDay(args, async (dir, date) => {
        const daily = await loadDaily(dir, date, str(args.who).trim() || undefined)
        const rows = daily.entries.map(e => `- [${e.id}] ${e.section} · ${e.who || '担当なし'} · ${e.text}${e.origin === 'auto' ? '' : `（${e.origin === 'manual' ? '足した行' : '直した行'}）`}`)
        const where = daily.saved ? 'ファイルに置いてある' : 'まだ置いていない下書き。daily_generate で置く'
        return text(`${daily.text}\n\n行の一覧（${where}）：\n${rows.join('\n')}`)
      }),
    },
    {
      name: 'daily_generate',
      description: '材料から下書きを作り、日ごとのファイル（.tadori/daily/YYYY-MM-DD.tsv）に置いて commit する。作り直しても、直した行・足した行・消した行は上書きしない。',
      inputSchema: { type: 'object', properties: { date: DATE }, additionalProperties: false },
      run: async args => withDay(args, async (dir, date) => text(`${date} の下書きを置きました。${committed(await generateDaily(dir, date))}`)),
    },
    {
      name: 'daily_add',
      description: '1 日の進行に行を足す（相談や、材料に出ない作業）。足した行は作り直しても残る。',
      inputSchema: { type: 'object', properties: { date: DATE, section: SECTION, ...ENTRY_FIELDS }, required: ['section', 'text'], additionalProperties: false },
      run: async args => withDay(args, async (dir, date) => {
        const { entry, commit, warnings } = await addDaily(dir, date, args)
        return text([`[${entry.id}] を足しました。${committed(commit)}`, ...warnings.map(w => `注意：${w}`)].join('\n'))
      }),
    },
    {
      name: 'daily_update',
      description: '1 日の進行の行を直す（id は daily の [ID]）。渡した項目だけ変わる。空文字（links・wbs は空の配列）を渡すと、その欄を空にする（本文は空にできない。行ごと消すなら daily_remove）。自動の行は「直した行」になり、作り直しても上書きされない。',
      inputSchema: { type: 'object', properties: { date: DATE, id: { type: 'string' }, section: SECTION, ...ENTRY_FIELDS }, required: ['id'], additionalProperties: false },
      run: async args => withDay(args, async (dir, date) => {
        const { entry, commit, warnings } = await updateDaily(dir, date, str(args.id), args)
        return text([`[${entry.id}] を直しました。${committed(commit)}`, ...warnings.map(w => `注意：${w}`)].join('\n'))
      }),
    },
    {
      name: 'daily_remove',
      description: '1 日の進行の行を消す（id は daily の [ID]）。自動の行は、作り直しても戻ってこない。',
      inputSchema: { type: 'object', properties: { date: DATE, id: { type: 'string' } }, required: ['id'], additionalProperties: false },
      run: async args => withDay(args, async (dir, date) => text(`[${str(args.id)}] を消しました。${committed((await removeDaily(dir, date, str(args.id))).commit)}`)),
    },
  ]
}

async function howToText(path: string | undefined, topic: string): Promise<ToolResult> {
  if (!path) return text('使い方の文書が見つかりません（guidePath が渡されていません）', true)
  const result = await howTo(path, topic)
  return text(result.text, result.isError)
}

/** 画面の中の専用カーソルへ指示を送る（人のマウスは使わない）。中身の検査はサーバーが行う */
async function sendToScreen(screenUrl: string, args: Record<string, unknown>): Promise<ToolResult> {
  let res: Response
  try {
    res = await fetch(`${screenUrl}/api/agent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-tadori': '1' },
      body: JSON.stringify(args),
    })
  } catch {
    return text(`tadori が立ち上がっていません（${screenUrl}）。デスクトップアプリを開くか、tadori serve で立ち上げてください`, true)
  }
  const body = await res.json().catch(() => ({})) as { error?: string; screens?: number }
  if (!res.ok) return text(body.error ?? `画面へ届けられませんでした（${res.status}）`, true)
  return text(`画面（${body.screens ?? 1} つ）へ届けました。人の画面で、専用カーソルが動きます`)
}

function buildTools(options: McpOptions): Tool[] {
  const str = (v: unknown) => (typeof v === 'string' ? v : '')
  // 書く道具は、open_project で替えた案件を読むので、同じ入れ物（options）を渡す
  return [...buildProjectTools(options), ...writeTools(options as WriteContext), {
    name: 'how_to',
    description: 'tadori の使い方を返す（はじめ方・台帳とルールの書き方・確かめ方・画面の案内の仕方・エージェントが守ること）。'
      + 'topic を空にすると話題の一覧。初めて使うときは start と agent-rules を読むこと。',
    inputSchema: {
      type: 'object',
      properties: { topic: { type: 'string', description: '話題（start・ledger・rules・check・daily・write・screen・links・sources・agent-rules）。空なら一覧' } },
      additionalProperties: false,
    },
    run: async args => howToText(options.guidePath, str(args.topic).trim()),
  }, {
    name: 'screen',
    description: '人が開いている tadori の画面を、画面の中の専用カーソルで操作して見せる（人のマウスは使わない）。'
      + 'action は point（指す）・click（押す）・type（欄に打つ）・go（画面を移る）・say（一言）・filter（画面を人で絞る。value に人の名前、空なら全員）。使い方は how_to の screen。'
      + '押せるのは人が画面で押せるものだけ。Windows のダイアログは操作できないので人に頼むこと。',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['point', 'click', 'type', 'go', 'say', 'filter'] },
        target: { type: 'string', description: '画面に出ている文字・ボタンの名前（例：ルールセット・ファイル・探す）' },
        value: { type: 'string', description: 'type で打つ文字。filter では人の名前（空なら全員）' },
        hash: { type: 'string', description: 'go の移り先（例：#rules・#trace-F-02）' },
        message: { type: 'string', description: '人に見せる一言（黄色の札に出る）' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    run: async args => sendToScreen(options.screenUrl ?? DEFAULT_SCREEN_URL, args),
  }, {
    name: 'glossary',
    description: 'tadori の画面と文書で使う言葉（工程・完了判定・残課題・タスク・漏れ・承認待ち・つながりなど）の意味と、画面のどこに出るかを返す。'
      + '人に画面を説明するときは、ここの言葉を使うこと。query を空にすると全部の言葉を返す。',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string', description: '探す言葉（空白で区切ると、全部を含むものだけ）。例：漏れ、タスク 遅れ' } },
      additionalProperties: false,
    },
    run: async args => text(await glossaryText(options.glossaryPath, typeof args.query === 'string' ? args.query : '')),
  }, {
    name: 'server_errors',
    description: '画面の裏で動いている tadori serve の中で起きた例外（画面に「サーバーの中で問題が起きました」と出たもの）を、新しい順に返す。'
      + '時刻・API・例外の種類と文・落ちた所（呼び出しの頭の数行）だけで、送られた本文は残していない。直すときは、この結果を人に見せてから。',
    inputSchema: { type: 'object', properties: { limit: { type: 'number', description: '何件まで（既定 10・最大 50）' } }, additionalProperties: false },
    run: async args => {
      const dir = options.logDir ?? defaultLogDir()
      const limit = Math.min(MAX_ERRORS, Math.max(1, typeof args.limit === 'number' ? Math.floor(args.limit) : DEFAULT_ERRORS))
      const errors = await readServerErrors(dir, limit)
      if (!errors.length) return text(`server の例外の記録はありません（記録の場所：${dir}）`)
      const lines = errors.map(e => [`- ${e.at} ${e.method} ${e.path}（案件：${e.project}）`, `  ${e.name}: ${e.message}`, ...e.stack.map(s => `    ${s}`)].join('\n'))
      return text([`server の例外 ${errors.length} 件（新しい順・記録の場所：${dir}）`, ...lines].join('\n'))
    },
  }]
}

const DEFAULT_ERRORS = 10
const MAX_ERRORS = 50

/** 1 つのメッセージに返事を作る。通知（id が無いもの）には null を返す */
export function createMcpHandler(options: McpOptions): (message: JsonRpcMessage) => Promise<JsonRpcResponse | null> {
  // 開く案件は open_project で替わるので、呼び出し元の options は変えずに写しを持つ
  const context: { -readonly [K in keyof McpOptions]: McpOptions[K] } = { ...options }
  const tools = buildTools(context)
  return async message => {
    if (message.id === undefined) return null
    const id = message.id
    const ok = (result: unknown): JsonRpcResponse => ({ jsonrpc: '2.0', id, result })
    switch (message.method) {
      case 'initialize': {
        const requested = (message.params as { protocolVersion?: unknown } | undefined)?.protocolVersion
        return ok({
          protocolVersion: typeof requested === 'string' ? requested : PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: 'tadori', version: options.version },
        })
      }
      case 'ping':
        return ok({})
      case 'tools/list':
        return ok({ tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) })
      case 'tools/call': {
        const params = (message.params ?? {}) as { name?: unknown; arguments?: unknown }
        const tool = tools.find(t => t.name === params.name)
        if (!tool) return ok(text(`知らない道具です：${String(params.name)}`, true))
        try {
          const args = params.arguments && typeof params.arguments === 'object' ? params.arguments as Record<string, unknown> : {}
          return ok(await tool.run(args))
        } catch (error: unknown) {
          // 道具の中の失敗は、エージェントが読めるように結果として返す
          return ok(text(`${tool.name} に失敗しました：${error instanceof Error ? error.message : String(error)}`, true))
        }
      }
      default:
        return { jsonrpc: '2.0', id, error: { code: -32601, message: `知らないメソッドです：${message.method}` } }
    }
  }
}

/** 標準入出力で MCP の口を開く。標準出力は MCP の返事だけに使う（ほかの表示は標準エラーへ） */
export function serveMcp(options: McpOptions): void {
  const handle = createMcpHandler(options)
  const lines = createInterface({ input: process.stdin })
  lines.on('line', line => {
    if (!line.trim()) return
    let message: JsonRpcMessage
    try {
      message = JSON.parse(line) as JsonRpcMessage
    } catch {
      process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'JSON として読めませんでした' } })}\n`)
      return
    }
    handle(message)
      .then(response => { if (response) process.stdout.write(`${JSON.stringify(response)}\n`) })
      .catch((error: unknown) => process.stderr.write(`tadori mcp: ${error instanceof Error ? error.stack : String(error)}\n`))
  })
}
