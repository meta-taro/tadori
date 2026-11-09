import { readFile } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { parseTsv, trace } from '@tadori/core'
import { formatCheck, formatTrace } from './format.js'
import { loadState, localToday } from './state.js'

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
      run: async args => withState(({ project }) => {
        const result = trace(project, str(args.id))
        return result ? text(formatTrace(result)) : text(`${str(args.id)} は台帳にありません。find_items で探してください`, true)
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
        const lines = found.slice(0, MAX_FOUND).map(i => `- ${i.id}（${state.labels.kinds[i.kind] ?? i.kind}）${i.title}`)
        if (found.length > MAX_FOUND) lines.push(`ほか ${found.length - MAX_FOUND} 件。言葉を足して絞ってください`)
        return text(lines.join('\n'))
      }),
    },
  ]
}

/** guide.md を「## <話題> <見出し>」ごとに分ける */
function guideSections(markdown: string): { intro: string; sections: Array<{ topic: string; title: string; body: string }> } {
  const [intro = '', ...parts] = markdown.split(/^## /m)
  return {
    intro: intro.trim(),
    sections: parts.map(part => {
      const [head = '', ...rest] = part.split('\n')
      const [topic = '', ...title] = head.trim().split(/\s+/)
      return { topic, title: title.join(' '), body: `## ${head.trim()}\n${rest.join('\n').trim()}` }
    }),
  }
}

async function howToText(path: string | undefined, topic: string): Promise<ToolResult> {
  if (!path) return text('使い方の文書が見つかりません（guidePath が渡されていません）', true)
  const { intro, sections } = guideSections(await readFile(path, 'utf8'))
  const list = sections.map(s => `- ${s.topic}：${s.title}`).join('\n')
  if (!topic) return text(`${intro}\n\n話題（topic に渡す）：\n${list}\n\n初めてなら start、エージェントは必ず agent-rules も読んでください。`)
  const found = sections.find(s => s.topic === topic)
  return found ? text(found.body) : text(`「${topic}」という話題はありません。\n${list}`, true)
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
  return [...buildProjectTools(options), {
    name: 'how_to',
    description: 'tadori の使い方を返す（はじめ方・台帳とルールの書き方・確かめ方・画面の案内の仕方・エージェントが守ること）。'
      + 'topic を空にすると話題の一覧。初めて使うときは start と agent-rules を読むこと。',
    inputSchema: {
      type: 'object',
      properties: { topic: { type: 'string', description: '話題（start・ledger・rules・check・screen・links・agent-rules）。空なら一覧' } },
      additionalProperties: false,
    },
    run: async args => howToText(options.guidePath, str(args.topic).trim()),
  }, {
    name: 'screen',
    description: '人が開いている tadori の画面を、画面の中の専用カーソルで操作して見せる（人のマウスは使わない）。'
      + 'action は point（指す）・click（押す）・type（欄に打つ）・go（画面を移る）・say（一言）。使い方は how_to の screen。'
      + '押せるのは人が画面で押せるものだけ。Windows のダイアログは操作できないので人に頼むこと。',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['point', 'click', 'type', 'go', 'say'] },
        target: { type: 'string', description: '画面に出ている文字・ボタンの名前（例：ルールセット・ファイル・探す）' },
        value: { type: 'string', description: 'type で打つ文字' },
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
  }]
}

/** 1 つのメッセージに返事を作る。通知（id が無いもの）には null を返す */
export function createMcpHandler(options: McpOptions): (message: JsonRpcMessage) => Promise<JsonRpcResponse | null> {
  const tools = buildTools(options)
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
