import './i18n.js'
import { readFile } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { currentLang, parseTsv, t, trace } from '@tadori/core'
import { fixText, formatCheck, formatTrace, originText } from './format.js'
import { howTo } from './guide.js'
import { committed, writeTools, type WriteContext } from './mcp-write.js'
import { addDaily, DailyInputError, generateDaily, isDay, loadDaily, removeDaily, updateDaily } from './daily.js'
import { loadState, localToday } from './state.js'
import { defaultLogDir, readServerErrors } from './error-log.js'

/**
 * tadori の MCP の口（標準入出力・1 行 1 つの JSON-RPC）。
 * 画面でできることを順に足していく。人の承認には口を作らない（承認するのは人だけ）。
 * 道具の説明はエージェントが読む。メッセージのたびに道具を組み立て、そのときの言語の文にする。
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

/** 案件のフォルダが無いときの返事 */
const noProject = () => text(t('Start with a project folder (e.g. tadori mcp examples/lend-v12)'), true)

/** 用語集を読み、言葉で絞って Markdown にする */
/** 用語集の見出し（日本語で書いてある）の英語。画面（ui/static/i18n.js）と同じ */
const GLOSSARY_GROUPS_EN: Readonly<Record<string, string>> = { WBS: 'WBS', ルール: 'Rules', 全体: 'General', 台帳: 'Ledger', 案件による: 'Per project', 結果: 'Results', 試験: 'Testing' }

async function glossaryText(path: string, query: string): Promise<string> {
  // 英語なら term_en などの英語の列を使う（空なら日本語のまま）。見出し（group）は日本語で書いてあるので英語に読み替える
  const isEnglish = currentLang() === 'en'
  const entries = parseTsv(await readFile(path, 'utf8')).rows.map(row => (isEnglish ? {
    ...row,
    group: GLOSSARY_GROUPS_EN[row.group ?? ''] ?? row.group,
    term: row.term_en || row.term,
    meaning: row.meaning_en || row.meaning,
    where: row.where_en || row.where,
    example: row.example_en || row.example,
  } : row))
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const shown = entries.filter(e => words.every(w => `${e.term} ${e.meaning} ${e.example}`.toLowerCase().includes(w)))
  if (!shown.length) return t('No term matches "{query}". Leave query empty to get every term.', { query })
  const groups = [...new Set(shown.map(e => e.group ?? ''))]
  return groups.map(group => [
    `## ${group}`,
    ...shown.filter(e => e.group === group).map(e =>
      `${t('- **{term}**: {meaning}', { term: e.term ?? '', meaning: e.meaning ?? '' })}${e.where ? t(' (screen: {where})', { where: e.where }) : ''}${e.example ? t('  e.g. {example}', { example: e.example }) : ''}`),
  ].join('\n')).join('\n\n')
}

/** 案件を読む道具。画面・CLI と同じ判定の核を通す（MCP だけの判定を作らない） */
function buildProjectTools(options: McpOptions): Tool[] {
  const withState = async <T>(use: (loaded: Awaited<ReturnType<typeof loadState>>) => T): Promise<T | ToolResult> => {
    if (!options.projectDir) return noProject()
    return use(await loadState(options.projectDir, options.today ?? localToday()))
  }
  const str = (v: unknown) => (typeof v === 'string' ? v : '')
  return [
    {
      name: 'get_remaining',
      description: t('Return the remaining work per phase (gaps and pending human approvals), days late, and whether work started before the previous phase gate. Same content as the screen\'s "Remaining work until release". No percentages or scores.'),
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      run: async () => withState(({ state }) => text(formatCheck(state))),
    },
    {
      name: 'list_leaks',
      description: t('Return the list of gaps (places where a link or column a rule requires is missing). Pass a phase ID (e.g. dd) as phase to get only the gaps of that phase\'s rules.'),
      inputSchema: { type: 'object', properties: { phase: { type: 'string', description: t('Phase ID (e.g. bd, dd, it). Empty for all') } }, additionalProperties: false },
      run: async args => withState(({ state }) => {
        const phase = str(args.phase)
        const ruleIds = new Set(state.rules.filter(r => !phase || r.phase === phase).map(r => r.id))
        const leaks = state.leaks.filter(l => !phase || ruleIds.has(l.rule))
        // 漏れごとに、担当と、どこをどう直せば消えるかを添える（エージェントが人に伝えやすいように）
        const lines = leaks.map(l => `- ${l.rule}·${l.itemId} ${l.message}${l.fix ? `\n  ${fixText(l.fix, l.owner)}` : ''}`)
        return text(lines.length ? lines.join('\n') : t('No gaps'))
      }),
    },
    {
      name: 'list_rules',
      description: t('Return the rules: the checked rules per phase, and the written agreements (kind note) that are read, not checked. Pass a category ID as group to get only that category (an empty string returns rules without a category). Read the agreements before writing, and follow them.'),
      inputSchema: { type: 'object', properties: {
        group: { type: 'string', description: t('Category ID from .tadori/rule-groups.tsv. Omit for all; an empty string for rules without a category') },
        kind: { type: 'string', description: t('Only this kind (e.g. note). Omit for all') },
      }, additionalProperties: false },
      run: async args => withState(({ state }) => {
        const group = typeof args.group === 'string' ? args.group.trim() : undefined
        const kind = str(args.kind).trim()
        const rules = state.rules.filter(r => (group === undefined || (r.group ?? '') === group) && (!kind || r.kind === kind))
        if (!rules.length) return text(t('No matching rules'))
        const groupName = (id: string | undefined) => {
          const group = id ? state.ruleGroups.find(g => g.id === id) : undefined
          if (!id) return t('No category')
          // ローカルの分類は、その人とエージェントの間だけの約束だと分かるように印を付ける
          return group?.scope === 'local' ? t('{name} · local', { name: group.name }) : group?.name ?? id
        }
        const phaseName = (id: string) => state.phases.find(p => p.id === id)?.name ?? id
        const lines = rules.map(r => t('- {id} [{group}] {kind}{phase}: {label}', {
          id: r.id, group: groupName(r.group), kind: r.kind, phase: r.phase ? ` · ${phaseName(r.phase)}` : '', label: r.label,
        }))
        return text(lines.join('\n'))
      }),
    },
    {
      name: 'trace',
      description: t('Follow the upstream and downstream links from one ledger row (a finding, a test case, a design section, etc.) and return where they break (✗). Links are judged only by ledger IDs, never by guessing. '
        + 'Only a person can confirm "yes, that was a gap", so show the result to a person and let them judge.'),
      inputSchema: { type: 'object', properties: { id: { type: 'string', description: t('ID of the row to start from (e.g. F-02)') } }, required: ['id'], additionalProperties: false },
      run: async args => withState(({ project, state }) => {
        const result = trace(project, str(args.id))
        return result ? text(formatTrace(result, state.origins)) : text(t('{id} is not in the ledger. Search with find_items', { id: str(args.id) }), true)
      }),
    },
    {
      name: 'find_items',
      description: t('Search ledger rows by ID or name (separate words with spaces to require all of them). Use it to find an ID to pass to trace.'),
      inputSchema: { type: 'object', properties: { query: { type: 'string', description: t('Words to search for (e.g. overdue, TC-07)') } }, required: ['query'], additionalProperties: false },
      run: async args => withState(({ state }) => {
        const words = str(args.query).trim().toLowerCase().split(/\s+/).filter(Boolean)
        const found = state.items.filter(i => words.every(w => `${i.id} ${i.title}`.toLowerCase().includes(w)))
        if (!found.length) return text(t('No row matches "{query}"', { query: str(args.query) }))
        const lines = found.slice(0, MAX_FOUND).map(i => {
          const origin = state.origins[i.id]
          return `${t('- {id} ({kind}) {title}', { id: i.id, kind: state.labels.kinds[i.kind] ?? i.kind, title: i.title })}${origin ? `\n  ${originText(origin)}` : ''}`
        })
        if (found.length > MAX_FOUND) lines.push(t('{count} more. Add words to narrow it down', { count: found.length - MAX_FOUND }))
        return text(lines.join('\n'))
      }),
    },
    ...dailyTools(options),
  ]
}

/** 1 日の進行の道具の入力の形（説明はそのときの言語で） */
function dailySchemas() {
  const SECTION = { type: 'string', enum: ['today', 'next', 'consult', 'upkeep'], description: t('today = Today / next = Next working day / consult = Questions / upkeep = Ledger upkeep (not work on deliverables)') }
  const DATE = { type: 'string', description: t('Date (YYYY-MM-DD). Empty for today') }
  const ENTRY_FIELDS = {
    who: { type: 'string', description: t('Owner (for two or more, "A・B")') },
    text: { type: 'string', description: t('Text (without the number or the trailing WBS. Put places and URLs in the notes)') },
    wbs: { type: 'array', items: { type: 'string' }, description: t('IDs of the related WBS tasks (e.g. W-03)') },
    links: {
      type: 'array', maxItems: 8,
      items: {
        type: 'object',
        properties: {
          label: { type: 'string', description: t('Display name (e.g. QA sheet, MR, design doc 3.2.5)') },
          url: { type: 'string', description: t('An http or https URL') },
          anchor: { type: 'string', description: t('A word in the text. The screen turns that word into the link (not shown at the end of the line). If the word is not in the text, it shows "display name ↗" at the end of the line') },
          nth: { type: 'number', description: t('Which occurrence, when the same word appears more than once (default 1)') },
        },
        required: ['label', 'url'], additionalProperties: false,
      },
      description: t('The places in the source of truth touched by this work. The screen shows "display name ↗" at the end of the line and opens it on click. Not included in the text read aloud; shown in the notes. When editing, pass all of them again'),
    },
    badges: {
      type: 'array', maxItems: 8,
      items: {
        type: 'object',
        properties: {
          text: { type: 'string', description: t('Badge text, up to 40 characters (e.g. late, waiting for review, due 11/12). You decide the value; tadori does not judge it') },
          tone: { type: 'string', enum: ['none', 'wait', 'hole', 'ok'], description: t('Color meaning: none = plain / wait = waiting / hole = needs attention / ok = good (default none)') },
        },
        required: ['text'], additionalProperties: false,
      },
      description: t('Small badges for the line, shown apart from the text on the screen and after the text in the written daily progress. When editing, pass all of them again (an empty array clears them)'),
    },
    issue: { type: 'string', description: t('Issue ID (a ledger row)') },
    note: { type: 'string', description: t('A short remark to add to the notes (read when asked)') },
    tag: { type: 'string', enum: ['', 'done', 'doing', 'plan', 'upkeep', 'checked'], description: t('Line tag: done = finished / doing = in progress / plan = planned / upkeep = ledger upkeep / checked = checked (empty for no tag)') },
  }
  return { SECTION, DATE, ENTRY_FIELDS }
}

/** 1 日の進行の道具：読む・作る・足す・直す・消す。人の承認には関わらない（1 日の進行は人とエージェントが書く記録） */
function dailyTools(options: McpOptions): Tool[] {
  const str = (v: unknown) => (typeof v === 'string' ? v : '')
  const { SECTION, DATE, ENTRY_FIELDS } = dailySchemas()
  /** 案件・日付を確かめてから、本体を動かす。入力の誤りは isError で返す */
  const withDay = async (args: Record<string, unknown>, work: (dir: string, date: string) => Promise<ToolResult>): Promise<ToolResult> => {
    if (!options.projectDir) return noProject()
    const date = str(args.date).trim() || (options.today ?? localToday())
    if (!isDay(date)) return text(t('Give date as YYYY-MM-DD'), true)
    try {
      return await work(options.projectDir, date)
    } catch (error: unknown) {
      if (error instanceof DailyInputError) return text(error.message, true)
      throw error
    }
  }
  const withWarnings = (head: string, warnings: readonly string[]) => text([head, ...warnings.map(w => t('Note: {warning}', { warning: w }))].join('\n'))
  return [
    {
      name: 'daily',
      description: t('Return a person\'s "daily progress" (Today, Next working day, Questions, Notes) and the list of lines (with [ID]). Pass an owner as who to get only that person\'s lines. '
        + 'It combines a draft built from the inputs (WBS status changes, ledger diffs, check records) with lines that people or agents edited. '
        + 'To edit the text or write a question, use daily_update / daily_add.'),
      inputSchema: { type: 'object', properties: { who: { type: 'string', description: t('Owner. Empty for everyone') }, date: DATE }, additionalProperties: false },
      run: async args => withDay(args, async (dir, date) => {
        const daily = await loadDaily(dir, date, str(args.who).trim() || undefined)
        const rows = daily.entries.map(e => `- [${e.id}] ${e.section} · ${e.who || t('no owner')} · ${e.text}${e.origin === 'auto' ? '' : e.origin === 'manual' ? t(' (added line)') : t(' (edited line)')}`)
        const where = daily.saved ? t('saved in the file') : t('a draft not saved yet; save it with daily_generate')
        return text(t('{text}\n\nLines ({where}):\n{rows}', { text: daily.text, where, rows: rows.join('\n') }))
      }),
    },
    {
      name: 'daily_generate',
      description: t('Build a draft from the inputs, save it to the per-day file (.tadori/daily/YYYY-MM-DD.tsv) and commit. Rebuilding never overwrites edited, added or removed lines.'),
      inputSchema: { type: 'object', properties: { date: DATE }, additionalProperties: false },
      run: async args => withDay(args, async (dir, date) => text(t('Saved the draft for {date}. {commit}', { date, commit: committed(await generateDaily(dir, date)) }))),
    },
    {
      name: 'daily_add',
      description: t('Add a line to daily progress (a question, or work that does not show up in the inputs). Added lines stay when the draft is rebuilt.'),
      inputSchema: { type: 'object', properties: { date: DATE, section: SECTION, ...ENTRY_FIELDS }, required: ['section', 'text'], additionalProperties: false },
      run: async args => withDay(args, async (dir, date) => {
        const { entry, commit, warnings } = await addDaily(dir, date, args)
        return withWarnings(t('Added [{id}]. {commit}', { id: entry.id, commit: committed(commit) }), warnings)
      }),
    },
    {
      name: 'daily_update',
      description: t('Edit a daily progress line (id is the [ID] from daily). Only the fields you pass change. Passing an empty string (an empty array for links, badges and wbs) clears that field (the text cannot be cleared; use daily_remove to delete the line). An automatic line becomes an "edited line" and is not overwritten when the draft is rebuilt.'),
      inputSchema: { type: 'object', properties: { date: DATE, id: { type: 'string' }, section: SECTION, ...ENTRY_FIELDS }, required: ['id'], additionalProperties: false },
      run: async args => withDay(args, async (dir, date) => {
        const { entry, commit, warnings } = await updateDaily(dir, date, str(args.id), args)
        return withWarnings(t('Edited [{id}]. {commit}', { id: entry.id, commit: committed(commit) }), warnings)
      }),
    },
    {
      name: 'daily_remove',
      description: t('Remove a daily progress line (id is the [ID] from daily). An automatic line does not come back when the draft is rebuilt.'),
      inputSchema: { type: 'object', properties: { date: DATE, id: { type: 'string' } }, required: ['id'], additionalProperties: false },
      run: async args => withDay(args, async (dir, date) => text(t('Removed [{id}]. {commit}', { id: str(args.id), commit: committed((await removeDaily(dir, date, str(args.id))).commit) }))),
    },
  ]
}

async function howToText(path: string | undefined, topic: string): Promise<ToolResult> {
  if (!path) return text(t('The how-to document was not found (no guidePath was given)'), true)
  const result = await howTo(path, topic)
  return text(result.text, result.isError)
}

/** 画面の中の専用カーソルへ指示を送る（人のマウスは使わない）。中身の検査はサーバーが行う */
async function sendToScreen(screenUrl: string, args: Record<string, unknown>): Promise<ToolResult> {
  let res: Response
  try {
    res = await fetch(`${screenUrl}/api/agent`, {
      method: 'POST',
      // 画面の server にも、いまの言語で誤りを返してもらう
      headers: { 'content-type': 'application/json', 'x-tadori': '1', 'x-tadori-lang': currentLangHeader() },
      body: JSON.stringify(args),
    })
  } catch {
    return text(t('tadori is not running ({url}). Open the desktop app or start it with tadori serve', { url: screenUrl }), true)
  }
  const body = await res.json().catch(() => ({})) as { error?: string; screens?: number }
  if (!res.ok) return text(body.error ?? t('Could not reach the screen ({status})', { status: res.status }), true)
  return text(t('Delivered to {count} screen(s). The dedicated cursor moves on the person\'s screen', { count: body.screens ?? 1 }))
}

/** いまの言語（server へ渡す） */
const currentLangHeader = (): string => currentLang()

function buildTools(options: McpOptions): Tool[] {
  const str = (v: unknown) => (typeof v === 'string' ? v : '')
  // 書く道具は、open_project で替えた案件を読むので、同じ入れ物（options）を渡す
  return [...buildProjectTools(options), ...writeTools(options as WriteContext), {
    name: 'how_to',
    description: t('Return how to use tadori (getting started, writing the ledger and rules, checking, guiding a person on the screen, what agents must follow). '
      + 'Leave topic empty for the list of topics. When you first use tadori, read start and agent-rules.'),
    inputSchema: {
      type: 'object',
      properties: { topic: { type: 'string', description: t('Topic (start, ledger, rules, check, daily, write, screen, links, sources, agent-rules). Empty for the list') } },
      additionalProperties: false,
    },
    run: async args => howToText(options.guidePath, str(args.topic).trim()),
  }, {
    name: 'screen',
    description: t('Show things to a person by operating the tadori screen they have open with a dedicated on-screen cursor (the person\'s mouse is not used). '
      + 'action is point, click, type (into a field), go (move to another view), say (a short remark) or filter (filter the screen by person: a name in value, empty for everyone). See how_to screen. '
      + 'You can only press what a person could press on the screen. Windows dialogs cannot be operated, so ask the person.'),
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['point', 'click', 'type', 'go', 'say', 'filter'] },
        target: { type: 'string', description: t('Text or button name shown on the screen (e.g. Rulesets, File, Search)') },
        value: { type: 'string', description: t('Text to type for type. For filter, a person\'s name (empty for everyone)') },
        hash: { type: 'string', description: t('Where go moves to (e.g. #rules, #trace-F-02)') },
        message: { type: 'string', description: t('A short remark to show the person (shown on a yellow note)') },
      },
      required: ['action'],
      additionalProperties: false,
    },
    run: async args => sendToScreen(options.screenUrl ?? DEFAULT_SCREEN_URL, args),
  }, {
    name: 'glossary',
    description: t('Return the meaning of the words used on the tadori screen and in its documents (phase, phase gate, remaining work, task, gap, pending approval, link, etc.) and where they appear on the screen. '
      + 'Use these words when you explain the screen to a person. Leave query empty to get every term.'),
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string', description: t('Words to search for (separate with spaces to require all). e.g. gap, task late') } },
      additionalProperties: false,
    },
    run: async args => text(await glossaryText(options.glossaryPath, typeof args.query === 'string' ? args.query : '')),
  }, {
    name: 'server_errors',
    description: t('Return, newest first, the errors raised inside tadori serve behind the screen (the ones the screen showed as "Something went wrong inside the server"). '
      + 'Only the time, API, error type and message, and where it failed (the top lines of the call stack) are kept; request bodies are not. Show the result to a person before fixing anything.'),
    inputSchema: { type: 'object', properties: { limit: { type: 'number', description: t('How many (default 10, max 50)') } }, additionalProperties: false },
    run: async args => {
      const dir = options.logDir ?? defaultLogDir()
      const limit = Math.min(MAX_ERRORS, Math.max(1, typeof args.limit === 'number' ? Math.floor(args.limit) : DEFAULT_ERRORS))
      const errors = await readServerErrors(dir, limit)
      if (!errors.length) return text(t('No server errors recorded (log location: {dir})', { dir }))
      const lines = errors.map(e => [t('- {at} {method} {path} (project: {project})', { at: e.at, method: e.method, path: e.path, project: e.project }), `  ${e.name}: ${e.message}`, ...e.stack.map(s => `    ${s}`)].join('\n'))
      return text([t('{count} server errors (newest first, log location: {dir})', { count: errors.length, dir }), ...lines].join('\n'))
    },
  }]
}

const DEFAULT_ERRORS = 10
const MAX_ERRORS = 50

/** 1 つのメッセージに返事を作る。通知（id が無いもの）には null を返す */
export function createMcpHandler(options: McpOptions): (message: JsonRpcMessage) => Promise<JsonRpcResponse | null> {
  // 開く案件は open_project で替わるので、呼び出し元の options は変えずに写しを持つ
  const context: { -readonly [K in keyof McpOptions]: McpOptions[K] } = { ...options }
  return async message => {
    if (message.id === undefined) return null
    const id = message.id
    const ok = (result: unknown): JsonRpcResponse => ({ jsonrpc: '2.0', id, result })
    // 道具の説明と返事の言葉は、このメッセージを受けたときの言語にする（組み立ては軽い）
    const tools = buildTools(context)
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
        const tool = tools.find(each => each.name === params.name)
        if (!tool) return ok(text(t('Unknown tool: {name}', { name: String(params.name) }), true))
        try {
          const args = params.arguments && typeof params.arguments === 'object' ? params.arguments as Record<string, unknown> : {}
          return ok(await tool.run(args))
        } catch (error: unknown) {
          // 道具の中の失敗は、エージェントが読めるように結果として返す
          return ok(text(t('{tool} failed: {reason}', { tool: tool.name, reason: error instanceof Error ? error.message : String(error) }), true))
        }
      }
      default:
        return { jsonrpc: '2.0', id, error: { code: -32601, message: t('Unknown method: {method}', { method: String(message.method) }) } }
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
      process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: t('Could not read it as JSON') } })}\n`)
      return
    }
    handle(message)
      .then(response => { if (response) process.stdout.write(`${JSON.stringify(response)}\n`) })
      .catch((error: unknown) => process.stderr.write(`tadori mcp: ${error instanceof Error ? error.stack : String(error)}\n`))
  })
}
