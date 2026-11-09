#!/usr/bin/env node
import { parseArgs } from 'node:util'
import { basename, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { appendChecks, initProject, ProjectLoadError, trace, type CheckRecord } from '@tadori/core'
import { formatCheck, formatTrace } from './format.js'
import { loadState, localToday } from './state.js'
import { startServer } from './server.js'
import { serveMcp } from './mcp.js'

const DEFAULT_PORT = 4870
const USAGE = `使い方:
  tadori init [案件のフォルダ] [--name 案件の名前]
  tadori check [案件のフォルダ] [--log --who 名前 --why 理由] [--today YYYY-MM-DD]
  tadori why <ID> [案件のフォルダ]
  tadori serve [案件のフォルダ] [--port ${DEFAULT_PORT}] [--today YYYY-MM-DD]
  tadori mcp [案件のフォルダ] [--screen http://127.0.0.1:4873]

  init   試す案件のフォルダに、最小の設定（.tadori/）と台帳（ledger/）を置く。あるファイルは書き換えない
  check  工程ごとの漏れと承認待ちを出す。漏れがあれば終了コード 1（CI でも使える）
         --log を付けると、チェックの記録（.tadori/checks.tsv）に 5W1H で足す
  why    1 件から上下に辿り、線が切れている所を出す
  serve  手元（127.0.0.1）で画面を立ち上げる
  mcp    MCP の口を標準入出力で開く（使い方・用語・残課題・漏れ・つながり・台帳の行を探す・画面の専用カーソル）
         --screen は専用カーソルで操作する画面の場所（既定はデスクトップアプリの http://127.0.0.1:4873）`

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
    help: { type: 'boolean', short: 'h' },
  },
})

const [command, ...rest] = positionals
const today = values.today ?? localToday()
if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) fail(`--today は YYYY-MM-DD で書いてください：${today}`)

function fail(message: string): never {
  process.stderr.write(`${message}\n`)
  process.exit(2)
}

/** check の結果をチェックの記録の行にする（ルールごとに 1 行） */
function toRecords(state: Awaited<ReturnType<typeof loadState>>['state'], dir: string): CheckRecord[] {
  const now = new Date()
  const when = `${today} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  return state.rules.filter(r => r.kind !== 'approval').map(rule => {
    const leaks = state.leaks.filter(l => l.rule === rule.id)
    return {
      when,
      who: values.who ?? 'エージェント',
      what: `${rule.id} · ${rule.label}`,
      where: relative(process.cwd(), dir) || '.',
      why: values.why ?? 'tadori check',
      how: 'tadori check',
      result: leaks.length ? `漏れ ${leaks.length} 件（${leaks.map(l => l.itemId).join('・')}）` : '満たす',
    }
  })
}

async function main(): Promise<void> {
  if (values.help || !command) {
    process.stdout.write(`${USAGE}\n`)
    return
  }

  if (command === 'init') {
    const dir = resolve(rest[0] ?? '.')
    const result = await initProject(dir, values.name ?? basename(dir))
    const lines = [
      dir,
      ...result.created.map(p => `  置いた　　　　　${p}`),
      ...result.skipped.map(p => `  あるので触らない　${p}`),
      '',
      '次にすること：',
      '  1. .tadori/phases.tsv の工程を、この案件に合わせて書き換える',
      '  2. .tadori/rulesets/ にルールを書く（ルールが無いうちは、漏れは出ません）',
      `  3. ledger/ に台帳の行と WBS を書き、tadori serve ${rest[0] ?? '.'} で画面を開く`,
      'commit はしていません。中身を確かめてから commit してください',
    ]
    process.stdout.write(`${lines.join('\n')}\n`)
    return
  }

  if (command === 'check') {
    const dir = resolve(rest[0] ?? '.')
    const { state } = await loadState(dir, today)
    process.stdout.write(`${formatCheck(state)}\n`)
    if (values.log) {
      const commit = await appendChecks(dir, toRecords(state, dir), `チェックの記録を追加（${values.why ?? 'tadori check'}）`)
      const pushNote = commit.unpushed === null || commit.unpushed === undefined
        ? '（push 先が設定されていません）'
        : `（push していない commit が ${commit.unpushed} 件。中身を確かめてから push してください）`
      process.stdout.write(commit.committed ? `チェックの記録を足して commit しました${pushNote}\n` : `チェックの記録を足しました（${commit.reason}）\n`)
    }
    process.exitCode = state.leaks.length ? 1 : 0
    return
  }

  if (command === 'why') {
    const id = rest[0]
    if (!id) fail('辿る ID を指定してください（例：tadori why F-02）')
    const dir = resolve(rest[1] ?? '.')
    const { project } = await loadState(dir, today)
    const result = trace(project, id)
    if (!result) fail(`${id} は台帳にありません`)
    process.stdout.write(`${formatTrace(result)}\n`)
    return
  }

  if (command === 'serve') {
    const dir = resolve(rest[0] ?? '.')
    await loadState(dir, today) // 先に読めるか確かめる（読めなければ、ここで理由を出して止める）
    const port = Number(values.port ?? DEFAULT_PORT)
    if (!Number.isInteger(port) || port < 0 || port > 65535) fail(`--port が正しくありません：${values.port}`)
    const uiDir = fileURLToPath(new URL('../../ui/static', import.meta.url))
    // --today を渡したときだけ日付を固定する。渡さなければ、サーバーが読むたびにその日の日付を使う
    const server = await startServer({ dir, port, uiDir, ...(values.today ? { today } : {}) })
    // --port 0 のときは OS が空いている番号を選ぶので、実際につないだ番号を出す（デスクトップアプリはこの行から URL を読む）
    const bound = typeof server.address === 'object' && server.address ? server.address.port : port
    process.stdout.write(`tadori を立ち上げました：http://127.0.0.1:${bound}/\n案件：${dir}\n止めるときは Ctrl+C\n`)
    return
  }

  if (command === 'mcp') {
    // 標準出力は MCP の返事だけに使う。案内は出さない
    serveMcp({
      glossaryPath: fileURLToPath(new URL('../../ui/static/glossary.tsv', import.meta.url)),
      guidePath: fileURLToPath(new URL('../guide.md', import.meta.url)),
      ...(values.screen ? { screenUrl: values.screen.replace(/\/+$/, '') } : {}),
      version: '0.0.1',
      today,
      ...(rest[0] ? { projectDir: resolve(rest[0]) } : {}),
    })
    return
  }

  fail(`知らないコマンドです：${command}\n\n${USAGE}`)
}

main().catch((error: unknown) => {
  if (error instanceof ProjectLoadError) fail(error.message)
  fail(error instanceof Error ? (error.stack ?? error.message) : String(error))
})
