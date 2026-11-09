import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { StatusChange } from '../usecase/daily.js'
import { PATHS } from './repository.js'
import { parseTsv } from './tsv.js'

const run = promisify(execFile)
/** WBS は大きくなることがあるので、git の出力の上限を広げておく */
const MAX_BUFFER = 64 * 1024 * 1024

/** WBS の中身から、タスクの ID と状態の表を作る */
const statusesOf = (text: string): Map<string, string> =>
  new Map(parseTsv(text).rows.filter(r => r.id).map(r => [r.id as string, r.status ?? '']))

function diff(before: Map<string, string>, after: Map<string, string>, date: string): StatusChange[] {
  return [...after].flatMap(([taskId, to]) => {
    const from = before.get(taskId)
    return from !== undefined && from !== to ? [{ taskId, date, from, to }] : []
  })
}

/**
 * WBS のタスクの状態が変わった日を、git の履歴（ledger/wbs.tsv の commit ごとの中身）から読む。
 * 日付を書く列を WBS に足すと同じ情報が 2 か所になるので、足さずに履歴から読む。
 * まだ commit していない書き換えは、today の変化として数える。git の外なら空（変化は読めない）。
 */
export async function readStatusChanges(dir: string, today: string): Promise<StatusChange[]> {
  let log: string
  try {
    ;({ stdout: log } = await run('git', ['log', '--reverse', '--format=%H %cs', '--', PATHS.wbs], { cwd: dir, maxBuffer: MAX_BUFFER }))
  } catch {
    // git が無い・git の外：変化の日は分からない
    return []
  }
  const changes: StatusChange[] = []
  let previous: Map<string, string> | null = null
  for (const line of log.split('\n').filter(Boolean)) {
    const [hash, date = ''] = line.split(' ')
    const { stdout } = await run('git', ['show', `${hash}:./${PATHS.wbs}`], { cwd: dir, maxBuffer: MAX_BUFFER })
    const current = statusesOf(stdout)
    if (previous) changes.push(...diff(previous, current, date))
    previous = current
  }
  try {
    const working = statusesOf(await readFile(join(dir, PATHS.wbs), 'utf8'))
    if (previous) changes.push(...diff(previous, working, today))
  } catch {
    // WBS が無い案件：変化は履歴の分だけ
  }
  return changes
}
