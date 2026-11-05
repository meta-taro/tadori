import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Phase, StatusDef } from '../domain/model.js'
import { commitFiles, type CommitResult } from './git.js'
import { PATHS } from './repository.js'
import { parseTsv, toTsv, updateCell } from './tsv.js'

export interface SettingsChange {
  readonly phases?: readonly Phase[]
  readonly statuses?: readonly StatusDef[]
}

async function writeText(dir: string, path: string, text: string): Promise<void> {
  await mkdir(dirname(join(dir, path)), { recursive: true })
  await writeFile(join(dir, path), text, 'utf8')
}

/** 設定を TSV に書き戻し、案件が git リポジトリなら commit する */
export async function saveSettings(dir: string, change: SettingsChange, message: string): Promise<CommitResult> {
  const written: string[] = []
  if (change.phases) {
    const rows = change.phases.map(p => ({ id: p.id, name: p.name, order: String(p.order) }))
    await writeText(dir, PATHS.phases, toTsv(['id', 'name', 'order'], rows))
    written.push(PATHS.phases)
  }
  if (change.statuses) {
    const rows = change.statuses.map(s => ({ id: s.id, name: s.name, tone: s.tone }))
    await writeText(dir, PATHS.statuses, toTsv(['id', 'name', 'tone'], rows))
    written.push(PATHS.statuses)
  }
  return commitFiles(dir, written, message)
}

/**
 * WBS の作業のステータスを書き換える。wbs.tsv のその 1 セルだけを変え、ほかはそのまま残す。
 * git リポジトリなら commit する。作業が無ければ null。
 */
export async function saveTaskStatus(dir: string, taskId: string, status: string): Promise<CommitResult | null> {
  const path = join(dir, PATHS.wbs)
  const next = updateCell(await readFile(path, 'utf8'), 'id', taskId, 'status', status)
  if (next === null) return null
  await writeFile(path, next, 'utf8')
  return commitFiles(dir, [PATHS.wbs], `${taskId} のステータスを ${status} に変更`)
}

/** チェックの記録（5W1H）の 1 行 */
export interface CheckRecord {
  readonly when: string
  readonly who: string
  readonly what: string
  readonly where: string
  readonly why: string
  readonly how: string
  readonly result: string
}

export const CHECK_COLUMNS = ['when', 'who', 'what', 'where', 'why', 'how', 'result'] as const

/** チェックの記録のファイルを読む。まだ無ければ null（読めない理由がほかにあれば投げる） */
async function readChecksText(dir: string): Promise<string | null> {
  try {
    return await readFile(join(dir, PATHS.checks), 'utf8')
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return null
    throw error
  }
}

/** チェックの記録を読む（まだ無ければ空） */
export async function readChecks(dir: string): Promise<CheckRecord[]> {
  const text = await readChecksText(dir)
  if (text === null) return []
  return parseTsv(text).rows.map(r => ({
    when: r.when ?? '', who: r.who ?? '', what: r.what ?? '', where: r.where ?? '', why: r.why ?? '', how: r.how ?? '', result: r.result ?? '',
  }))
}

/**
 * チェックの記録に行を足す（追記だけ。過去の行も人が書いた # の行も書き換えない）。git リポジトリなら commit する。
 * 見出しの列が決まった形と違うときは、列をずらして書かないよう止める。
 */
export async function appendChecks(dir: string, records: readonly CheckRecord[], message: string): Promise<CommitResult> {
  if (!records.length) return { committed: false, reason: '足す行が無いので commit していません' }
  const body = toTsv(CHECK_COLUMNS, records.map(r => ({ ...r })))
  const text = await readChecksText(dir)
  const header = text === null ? [] : parseTsv(text).header

  if (text === null || header.length === 0) {
    // まだ記録が無い（または # の行だけ）：見出しから書く。# の行があれば残す
    await writeText(dir, PATHS.checks, `${text ?? ''}${text && !text.endsWith('\n') ? '\n' : ''}${body}`)
  } else {
    if (header.join('\t') !== CHECK_COLUMNS.join('\t')) {
      throw new Error(`${PATHS.checks} の見出しが決まった形（${CHECK_COLUMNS.join(' ')}）と違うので、追記しません`)
    }
    const separator = text.endsWith('\n') ? '' : '\n' // 末尾に改行が無いと、前の行にくっついてしまう
    await appendFile(join(dir, PATHS.checks), separator + body.split('\n').slice(1).join('\n'), 'utf8')
  }
  return commitFiles(dir, [PATHS.checks], message)
}
