import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { memberOf, type DailyEntry, type Member } from '../usecase/daily-entries.js'
import { PATHS } from './repository.js'
import { parseTsv } from './tsv.js'

const run = promisify(execFile)
const MAX_BUFFER = 64 * 1024 * 1024

type Rows = Map<string, Record<string, string>>
const rowsOf = (text: string): Rows => new Map(parseTsv(text).rows.filter(r => r.id).map(r => [r.id as string, r]))

async function show(dir: string, rev: string): Promise<Rows> {
  try {
    const { stdout } = await run('git', ['show', `${rev}:./${PATHS.items}`], { cwd: dir, maxBuffer: MAX_BUFFER })
    return rowsOf(stdout)
  } catch {
    // その版に台帳が無い（最初の commit の前など）
    return new Map()
  }
}

/** 台帳の 2 つの版を比べ、足した行と直した行を、文にする */
function ledgerEntries(before: Rows, after: Rows, who: string): DailyEntry[] {
  const entry = (key: string, text: string): DailyEntry => ({ id: '', who, section: 'today', text, wbs: [], origin: 'auto', key })
  return [...after].flatMap(([id, row]) => {
    const old = before.get(id)
    if (!old) return [entry(`ledger:add:${id}`, `台帳に ${id}（${row.title ?? ''}）を足した`)]
    const changed = Object.keys(row).filter(col => col !== 'id' && (row[col] ?? '') !== (old[col] ?? ''))
    return changed.length ? [entry(`ledger:edit:${id}`, `台帳の ${id}（${row.title ?? ''}）の ${changed.join('・')} を直した`)] : []
  })
}

/** その日の commit で、台帳に何をしたか（だれの commit かを担当にする） */
async function ledgerActivity(dir: string, date: string, today: string, members: readonly Member[]): Promise<DailyEntry[]> {
  let log: string
  try {
    ;({ stdout: log } = await run('git', ['log', '--reverse', '--format=%H%x09%an%x09%cs', '--', PATHS.items], { cwd: dir, maxBuffer: MAX_BUFFER }))
  } catch {
    // git の外：台帳の差分は読めない
    return []
  }
  const entries: DailyEntry[] = []
  for (const line of log.split('\n').filter(Boolean)) {
    const [hash = '', author = '', day = ''] = line.split('\t')
    if (day !== date) continue
    entries.push(...ledgerEntries(await show(dir, `${hash}^`), await show(dir, hash), memberOf(author, members)))
  }
  if (date === today) {
    // まだ commit していない書き換え：だれがしたかは分からないので担当は空
    try {
      const working = rowsOf(await readFile(join(dir, PATHS.items), 'utf8'))
      entries.push(...ledgerEntries(await show(dir, 'HEAD'), working, ''))
    } catch {
      // 台帳が無い案件
    }
  }
  // 同じ行を 1 日に何度も直したら、1 件にまとめる（最後の言い方を使う）
  return [...new Map(entries.map(e => [e.key, e])).values()]
}

/** その日のチェックの記録（5W1H）を、だれが何を確かめたかの文にする */
async function checkActivity(dir: string, date: string): Promise<DailyEntry[]> {
  let text: string
  try {
    text = await readFile(join(dir, PATHS.checks), 'utf8')
  } catch {
    // チェックの記録がまだ無い
    return []
  }
  return parseTsv(text).rows
    .filter(r => (r.when ?? '').startsWith(date))
    .map(r => ({
      id: '', who: r.who ?? '', section: 'today' as const, wbs: [], origin: 'auto' as const,
      text: `${r.what ?? ''} を確かめた（${r.result ?? ''}）`,
      key: `check:${r.when ?? ''}:${r.what ?? ''}`,
    }))
}

/**
 * その日に、台帳とチェックの記録で何をしたか。材料は案件のリポジトリの中の記録だけ（外の道具とは同期しない）。
 * today は手元の今日（まだ commit していない書き換えを、その日の分として数えるため）。
 */
export async function readActivity(dir: string, date: string, today: string, members: readonly Member[]): Promise<DailyEntry[]> {
  return [...(await ledgerActivity(dir, date, today, members)), ...(await checkActivity(dir, date))]
}
