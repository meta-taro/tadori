import { readFile } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { parseTsv } from '@tadori/core'

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
}

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

function buildTools(options: McpOptions): Tool[] {
  return [{
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
