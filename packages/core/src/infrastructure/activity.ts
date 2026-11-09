import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { joinList, t } from '../i18n.js'
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

export interface ActivityOptions {
  /** 同じ種類の行をこの数より多く足した・直した日は、種類ごとに 1 件にまとめる（台帳を最初に書いた日に、数十件並ばないように） */
  readonly groupAfter?: number
  /** 種類の読み方（.tadori/kinds.tsv） */
  readonly kindLabels?: Readonly<Record<string, string>>
  /**
   * 「やったこと」に当たる種類（.tadori/kinds.tsv の work 列）。この種類の行を足した・直したことは今日の作業として出す。
   * それ以外の種類の行を足した・直したことは「台帳の整備」として分ける（成果物を直し終えたと読み違えないように）
   */
  readonly workKinds?: readonly string[]
}
const DEFAULT_GROUP_AFTER = 3

type LedgerEntry = DailyEntry & { kind: string; rowId: string }

/** 台帳の 2 つの版を比べ、足した行と直した行を、文にする */
function ledgerEntries(before: Rows, after: Rows, who: string, options: ActivityOptions): LedgerEntry[] {
  const label = (kind: string) => options.kindLabels?.[kind] ?? kind
  const isWork = (kind: string) => (options.workKinds ?? []).includes(kind)
  const entry = (key: string, text: string, kind: string, id: string): LedgerEntry =>
    ({ id: '', who, section: isWork(kind) ? 'today' : 'upkeep', text, wbs: [], origin: 'auto', key, kind, rowId: id, tag: isWork(kind) ? 'done' : 'upkeep' })
  return [...after].flatMap(([id, row]) => {
    const old = before.get(id)
    const kind = row.kind ?? ''
    const title = row.title ?? ''
    if (!old) {
      const text = isWork(kind)
        ? t('Recorded {kind} {id} ({title})', { kind: label(kind), id, title })
        : t('Added {id} ({title}) to the ledger', { id, title })
      return [entry(`ledger:add:${id}`, text, kind, id)]
    }
    const changed = Object.keys(row).filter(col => col !== 'id' && (row[col] ?? '') !== (old[col] ?? ''))
    if (!changed.length) return []
    const text = isWork(kind)
      ? t('Revised {kind} {id} ({title})', { kind: label(kind), id, title })
      : t('Edited {columns} of {id} ({title}) in the ledger', { columns: joinList(changed), id, title })
    return [entry(`ledger:edit:${id}`, text, kind, id)]
  })
}

/** 同じ担当・同じ種類・同じしたこと（足した／直した）が多い分を、1 件にまとめる。ID は補足に回す */
function grouped(entries: Array<DailyEntry & { kind?: string; rowId?: string }>, options: ActivityOptions): DailyEntry[] {
  const limit = options.groupAfter ?? DEFAULT_GROUP_AFTER
  const groupKey = (e: DailyEntry & { kind?: string }) => [e.who, e.kind, e.section, (e.key ?? '').startsWith('ledger:add:') ? 'add' : 'edit'].join('|')
  const counts = new Map<string, number>()
  for (const e of entries) counts.set(groupKey(e), (counts.get(groupKey(e)) ?? 0) + 1)
  const done = new Set<string>()
  return entries.flatMap(({ kind = '', rowId = '', ...e }) => {
    const k = groupKey({ ...e, kind })
    if ((counts.get(k) ?? 0) <= limit) return [e]
    if (done.has(k)) return []
    done.add(k)
    const same = entries.filter(x => groupKey(x) === k)
    const isAdd = k.endsWith('|add')
    const label = options.kindLabels?.[kind] ?? kind
    const vars = { kind: label, count: same.length }
    const text = e.section === 'today'
      ? (isAdd ? t('Recorded {count} {kind} entries', vars) : t('Revised {count} {kind} entries', vars))
      : (isAdd ? t('Added {count} {kind} rows to the ledger', vars) : t('Edited {count} {kind} rows in the ledger', vars))
    return [{ ...e, text, note: joinList(same.map(x => x.rowId ?? '')), key: `ledger:${isAdd ? 'add' : 'edit'}-kind:${kind}` }]
  })
}

/** その日の commit で、台帳に何をしたか（だれの commit かを担当にする） */
async function ledgerActivity(dir: string, date: string, today: string, members: readonly Member[], options: ActivityOptions): Promise<DailyEntry[]> {
  let log: string
  try {
    ;({ stdout: log } = await run('git', ['log', '--reverse', '--format=%H%x09%an%x09%cs', '--', PATHS.items], { cwd: dir, maxBuffer: MAX_BUFFER }))
  } catch {
    // git の外：台帳の差分は読めない
    return []
  }
  const entries: Array<DailyEntry & { kind?: string; rowId?: string }> = []
  for (const line of log.split('\n').filter(Boolean)) {
    const [hash = '', author = '', day = ''] = line.split('\t')
    if (day !== date) continue
    entries.push(...ledgerEntries(await show(dir, `${hash}^`), await show(dir, hash), memberOf(author, members), options))
  }
  if (date === today) {
    // まだ commit していない書き換え：だれがしたかは分からないので担当は空
    try {
      const working = rowsOf(await readFile(join(dir, PATHS.items), 'utf8'))
      entries.push(...ledgerEntries(await show(dir, 'HEAD'), working, '', options))
    } catch {
      // 台帳が無い案件
    }
  }
  // 同じ行を 1 日に何度も直したら、1 件にまとめる（最後の言い方を使う）。そのうえで多い種類をまとめる
  return grouped([...new Map(entries.map(e => [e.key, e])).values()], options)
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
      id: '', who: r.who ?? '', section: 'today' as const, wbs: [], origin: 'auto' as const, tag: 'checked',
      text: t('Checked {what} ({result})', { what: r.what ?? '', result: r.result ?? '' }),
      key: `check:${r.when ?? ''}:${r.what ?? ''}`,
    }))
}

/**
 * その日に、台帳とチェックの記録で何をしたか。材料は案件のリポジトリの中の記録だけ（外の道具とは同期しない）。
 * today は手元の今日（まだ commit していない書き換えを、その日の分として数えるため）。
 */
export async function readActivity(dir: string, date: string, today: string, members: readonly Member[], options: ActivityOptions = {}): Promise<DailyEntry[]> {
  return [...(await ledgerActivity(dir, date, today, members, options)), ...(await checkActivity(dir, date))]
}
