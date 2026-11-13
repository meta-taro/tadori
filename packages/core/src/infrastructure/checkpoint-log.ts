import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { STAGED_CHECKPOINT } from '../domain/model.js'
import { t } from '../i18n.js'
import { refusalsOf, summaryOf, SUMMARY_RULE, type CheckpointAnswer, type CheckpointRow } from '../usecase/checkpoint.js'
import { commitFiles, type CommitResult } from './git.js'
import { WriteRefused } from './project-writer.js'
import { loadProject, PATHS } from './repository.js'
import { parseTsv, toTsv } from './tsv.js'

const run = promisify(execFile)

/** 節目で確かめた記録。追記だけで、過去の行は書き換えない（後から「そのとき何を当てたか」を読むための証拠） */
export const CHECKPOINT_LOG = '.tadori/checkpoint-log.tsv'
export const CHECKPOINT_LOG_COLUMNS = ['run', 'when', 'who', 'at', 'target', 'ruleset', 'rule', 'result', 'where', 'note'] as const

async function readLogText(dir: string): Promise<string | null> {
  try {
    return await readFile(join(dir, CHECKPOINT_LOG), 'utf8')
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return null
    throw error
  }
}

/** 記録を読む（まだ無ければ空）。ファイルの順（＝書いた順）のまま返す */
export async function readCheckpointLog(dir: string): Promise<CheckpointRow[]> {
  const text = await readLogText(dir)
  if (text === null) return []
  return parseTsv(text).rows.map(r => Object.fromEntries(CHECKPOINT_LOG_COLUMNS.map(c => [c, r[c] ?? '']))) as unknown as CheckpointRow[]
}

/**
 * いま stage してある変更の印（記録のファイル自身の変更は数えない）。stage が空なら null。
 * コミット前の節目は、この印を対象にして記録し、pre-commit で同じ印かを確かめる（確かめたあとに中身を替えたら通らない）
 */
export async function stagedDigest(dir: string): Promise<string | null> {
  const { stdout } = await run('git', ['diff', '--cached', '--binary', '--no-color', '--', '.', `:(exclude)${CHECKPOINT_LOG}`], { cwd: dir, maxBuffer: 256 * 1024 * 1024 })
  if (!stdout) return null
  return createHash('sha256').update(stdout).digest('hex').slice(0, 16)
}

/** その時点のルールセットの版（ルールの TSV の最後の commit。手元で直したままなら +dirty。git でなければ空） */
export async function rulesetVersion(dir: string): Promise<string> {
  try {
    const { stdout: commit } = await run('git', ['log', '-1', '--format=%h', '--', PATHS.rulesets], { cwd: dir })
    const { stdout: dirty } = await run('git', ['status', '--porcelain', '--', PATHS.rulesets], { cwd: dir })
    return `${commit.trim()}${dirty.trim() ? '+dirty' : ''}`
  } catch {
    // git リポジトリでない案件もある。版が分からないことは空で残す（記録そのものは止めない）
    return ''
  }
}

export interface CheckpointInput {
  readonly at: string
  /** WBS のタスク ID か台帳の ID。コミット前の節目では使わない（stage の印を使う） */
  readonly target?: string
  readonly who: string
  readonly answers: readonly CheckpointAnswer[]
}

export interface CheckpointWritten {
  readonly run: string
  readonly target: string
  readonly summary: string
  readonly commit: CommitResult
}

const DAY = /^\d{4}-\d{2}-\d{2}$/
const pad = (n: number) => String(n).padStart(2, '0')
const stamp = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`

/** 対象を決める。コミット前は stage の印、ほかは台帳か WBS にある ID でなければ断る */
async function targetOf(dir: string, input: CheckpointInput, ids: ReadonlySet<string>): Promise<{ target: string; problems: string[] }> {
  if (input.at === STAGED_CHECKPOINT) {
    const digest = await stagedDigest(dir)
    return digest ? { target: digest, problems: [] } : { target: '', problems: [t('Nothing is staged. Stage the change you are about to commit, then record')] }
  }
  const target = (input.target ?? '').trim()
  if (!target) return { target, problems: [t('Give the target: the WBS task ID or ledger ID this check is for')] }
  // 日に 1 回の節目（朝会・夕会の前など）は、その日の日付を対象にしてよい
  if (DAY.test(target)) return { target, problems: [] }
  return ids.has(target) ? { target, problems: [] } : { target, problems: [t('{id} is not in the ledger or the WBS (for a once-a-day checkpoint, give the date as YYYY-MM-DD)', { id: target })] }
}

/**
 * 節目の記録を足す。その節目に効くルールの全部に、結果と根拠の場所が無ければ書かずに断る（WriteRefused）。
 * 書けたら、項目ごとの行と、まとめの行（rule が *）を足して commit する
 */
export async function appendCheckpoint(dir: string, input: CheckpointInput): Promise<CheckpointWritten> {
  const project = await loadProject(dir)
  const { target, problems } = await targetOf(dir, input, new Set(project.items.map(i => i.id)))
  const all = [...problems, ...refusalsOf(project.rules, input.at, input.answers)]
  if (!project.rules.some(r => r.at?.includes(input.at))) all.push(t('No rule applies at the checkpoint {at}', { at: input.at }))
  if (all.length) throw new WriteRefused(all)

  const log = await readCheckpointLog(dir)
  const now = new Date()
  const runId = `${stamp(now).replace(/[-: ]/g, '')}-${new Set(log.map(r => r.run)).size + 1}`
  const base = { run: runId, when: stamp(now), who: input.who, at: input.at, target, ruleset: await rulesetVersion(dir) }
  const summary = summaryOf(input.at, input.answers)
  const rows: CheckpointRow[] = [
    ...input.answers.map(a => ({ ...base, rule: a.rule, result: a.result, where: a.where.trim(), note: (a.note ?? '').trim() })),
    { ...base, rule: SUMMARY_RULE, result: input.answers.some(a => a.result === 'open') ? 'open' : 'clear', where: summary, note: input.answers.map(a => a.rule).join('|') },
  ]
  await writeRows(dir, rows)
  const commit = await commitFiles(dir, [CHECKPOINT_LOG], t('Record checkpoint {at} for {target}', { at: input.at, target }))
  return { run: runId, target, summary, commit }
}

async function writeRows(dir: string, rows: readonly CheckpointRow[]): Promise<void> {
  const body = toTsv(CHECKPOINT_LOG_COLUMNS, rows.map(r => ({ ...r })))
  const text = await readLogText(dir)
  if (text === null || parseTsv(text).header.length === 0) {
    await mkdir(dirname(join(dir, CHECKPOINT_LOG)), { recursive: true })
    await writeFile(join(dir, CHECKPOINT_LOG), `${text ?? ''}${text && !text.endsWith('\n') ? '\n' : ''}${body}`, 'utf8')
    return
  }
  if (parseTsv(text).header.join('\t') !== CHECKPOINT_LOG_COLUMNS.join('\t')) {
    throw new Error(t('Not appending: the header of {file} differs from the expected one ({columns})', { file: CHECKPOINT_LOG, columns: CHECKPOINT_LOG_COLUMNS.join(' ') }))
  }
  const separator = text.endsWith('\n') ? '' : '\n' // 末尾に改行が無いと、前の行にくっついてしまう
  await appendFile(join(dir, CHECKPOINT_LOG), separator + body.split('\n').slice(1).join('\n'), 'utf8')
}
