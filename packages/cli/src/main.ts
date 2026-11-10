#!/usr/bin/env node
import { parseArgs } from 'node:util'
import { basename, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import './i18n.js'
import { appendChecks, initProject, langOf, ProjectLoadError, setLang, t, trace, type CheckRecord } from '@tadori/core'
import { formatCheck, formatTrace } from './format.js'
import { loadState, localToday } from './state.js'
import { startServer } from './server.js'
import { CLI_VERSION } from './version.js'
import { serveMcp } from './mcp.js'
import { howTo } from './guide.js'
import { runCheck } from './check-log.js'
import { isDay, loadDaily } from './daily.js'
import { parentPidFromEnv, watchParent } from './parent-watch.js'

const DEFAULT_PORT = 4870
/** 使い方（いまの言語で。日本語の文は i18n-ja.ts） */
const usage = (): string => t(`Usage:
  tadori init [project folder] [--name project name]
  tadori check [project folder] [--log --who name --why reason] [--today YYYY-MM-DD]
  tadori why <ID> [project folder]
  tadori serve [project folder] [--port {port}] [--today YYYY-MM-DD]
  tadori daily [project folder] [--who owner] [--date YYYY-MM-DD]
  tadori how-to [topic]
  tadori mcp [project folder] [--screen http://127.0.0.1:4873]

  init   Put the minimum settings (.tadori/) and ledger (ledger/) into a project folder to try. Existing files are not changed
  check  Show the gaps and pending approvals per phase. Exit code 1 if there are gaps (works in CI too)
         With --log, add the results to the check records (.tadori/checks.tsv) as 5W1H
  why    Follow links up and down from one row and show where they break
  serve  Start the screen on this machine (127.0.0.1)
  daily  Daily progress per person (Today, Next working day, Questions, Notes). --who filters by owner
  how-to Show how to use tadori (same content as MCP how_to). Topics: start, ledger, rules, check, daily, write, screen, links, sources, agent-rules
  mcp    Open the MCP server on standard input/output (how-to, glossary, remaining work, gaps, links, ledger search, the dedicated screen cursor)
         --screen is where the screen operated by the dedicated cursor lives (default: the desktop app at http://127.0.0.1:4873)

  --lang en|ja  Language of messages (default: TADORI_LANG, then the OS language)`, { port: DEFAULT_PORT })

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    port: { type: 'string' },
    today: { type: 'string' },
    log: { type: 'boolean' },
    who: { type: 'string' },
    why: { type: 'string' },
    name: { type: 'string' },
    screen: { type: 'string' },
    date: { type: 'string' },
    lang: { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  },
})

// 言葉の言語：--lang → TADORI_LANG → OS の言語（core の detectLang）。--lang はほかの検査より先に効かせる
if (values.lang !== undefined) {
  const lang = langOf(values.lang)
  if (!lang) fail(t('--lang must be en or ja: {value}', { value: values.lang }))
  setLang(lang)
}

const [command, ...rest] = positionals
const today = values.today ?? localToday()
if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) fail(t('Write --today as YYYY-MM-DD: {value}', { value: today }))

function fail(message: string): never {
  process.stderr.write(`${message}\n`)
  process.exit(2)
}

async function main(): Promise<void> {
  if (values.help || !command) {
    process.stdout.write(`${usage()}\n`)
    return
  }

  if (command === 'init') {
    const dir = resolve(rest[0] ?? '.')
    const result = await initProject(dir, values.name ?? basename(dir))
    const lines = [
      dir,
      ...result.created.map(p => t('  created          {path}', { path: p })),
      ...result.skipped.map(p => t('  exists, untouched {path}', { path: p })),
      '',
      t('Next steps:\n  1. Rewrite the phases in .tadori/phases.tsv to fit this project\n  2. Write rules in .tadori/rulesets/ (no gaps are reported until there are rules)\n  3. Write ledger rows and the WBS in ledger/, then open the screen with tadori serve {dir}\nNothing was committed. Check the contents, then commit', { dir: rest[0] ?? '.' }),
    ]
    process.stdout.write(`${lines.join('\n')}\n`)
    return
  }

  if (command === 'check') {
    const dir = resolve(rest[0] ?? '.')
    const run = await runCheck(dir, { today, ...(values.log ? { log: true } : {}), ...(values.who ? { who: values.who } : {}), ...(values.why ? { why: values.why } : {}) })
    process.stdout.write(`${run.text}\n`)
    if (run.commit) {
      const commit = run.commit
      const pushNote = commit.unpushed === null || commit.unpushed === undefined
        ? t(' (no push destination is set)')
        : t(' ({count} commits not pushed yet. Check the contents, then push)', { count: commit.unpushed })
      process.stdout.write(commit.committed
        ? `${t('Added the check records and committed{note}', { note: pushNote })}\n`
        : `${t('Added the check records ({reason})', { reason: commit.reason ?? '' })}\n`)
    }
    process.exitCode = run.leakCount ? 1 : 0
    return
  }

  if (command === 'why') {
    const id = rest[0]
    if (!id) fail(t('Give the ID to follow (e.g. tadori why F-02)'))
    const dir = resolve(rest[1] ?? '.')
    const { project, state } = await loadState(dir, today)
    const result = trace(project, id)
    if (!result) fail(t('{id} is not in the ledger', { id }))
    process.stdout.write(`${formatTrace(result, state.origins)}\n`)
    return
  }

  if (command === 'serve') {
    const dir = resolve(rest[0] ?? '.')
    await loadState(dir, today) // 先に読めるか確かめる（読めなければ、ここで理由を出して止める）
    const port = Number(values.port ?? DEFAULT_PORT)
    if (!Number.isInteger(port) || port < 0 || port > 65535) fail(t('--port is not valid: {value}', { value: String(values.port) }))
    const uiDir = fileURLToPath(new URL('../../ui/static', import.meta.url))
    // --today を渡したときだけ日付を固定する。渡さなければ、サーバーが読むたびにその日の日付を使う
    // デスクトップアプリから起こしたときは、アプリの版を画面に出す（ヘルプの「バージョンと更新」）
    const appVersion = process.env.TADORI_APP_VERSION?.trim()
    // TADORI_UPDATE_CHECK=off なら、新しい版を見に行かない（外へ出られない環境や、テストのため）
    const updateOff = process.env.TADORI_UPDATE_CHECK?.trim().toLowerCase() === 'off'
    const server = await startServer({
      dir, port, uiDir, ...(values.today ? { today } : {}), ...(appVersion ? { appVersion } : {}),
      ...(updateOff ? { checkUpdate: async () => { throw new Error(t('Checking for new versions is turned off (TADORI_UPDATE_CHECK=off)')) } } : {}),
    })
    // --port 0 のときは OS が空いている番号を選ぶので、実際につないだ番号を出す（デスクトップアプリはこの行から URL を読む）
    const bound = typeof server.address === 'object' && server.address ? server.address.port : port
    // URL の後ろは改行にする（デスクトップアプリは URL を空白か改行まで読む）
    process.stdout.write(`${t('tadori started: {url}\nProject: {dir}\nPress Ctrl+C to stop', { url: `http://127.0.0.1:${bound}/`, dir })}\n`)
    // デスクトップアプリから起こしたときは、アプリが落ちたら一緒に止まる（残って番号をふさがないように）
    const parentPid = parentPidFromEnv(process.env.TADORI_PARENT_PID)
    if (parentPid) watchParent(parentPid, () => { void server.close().finally(() => process.exit(0)) })
    return
  }

  if (command === 'daily') {
    const dir = resolve(rest[0] ?? '.')
    const date = values.date ?? today
    if (!isDay(date)) fail(t('Write --date as YYYY-MM-DD: {value}', { value: date }))
    const daily = await loadDaily(dir, date, values.who)
    process.stdout.write(`${daily.text}\n`)
    return
  }

  if (command === 'how-to') {
    const result = await howTo(fileURLToPath(new URL('../guide.md', import.meta.url)), (rest[0] ?? '').trim())
    process.stdout.write(`${result.text}
`)
    process.exitCode = result.isError ? 2 : 0
    return
  }

  if (command === 'mcp') {
    // 標準出力は MCP の返事だけに使う。案内は出さない
    serveMcp({
      glossaryPath: fileURLToPath(new URL('../../ui/static/glossary.tsv', import.meta.url)),
      guidePath: fileURLToPath(new URL('../guide.md', import.meta.url)),
      ...(values.screen ? { screenUrl: values.screen.replace(/\/+$/, '') } : {}),
      version: CLI_VERSION,
      today,
      ...(rest[0] ? { projectDir: resolve(rest[0]) } : {}),
    })
    return
  }

  fail(`${t('Unknown command: {command}', { command })}\n\n${usage()}`)
}

main().catch((error: unknown) => {
  if (error instanceof ProjectLoadError) fail(error.message)
  fail(error instanceof Error ? (error.stack ?? error.message) : String(error))
})
