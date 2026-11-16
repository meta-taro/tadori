import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { t } from '../i18n.js'

const run = promisify(execFile)

/** 文書の 1 つの版（その文書を変えた commit） */
export interface DocVersion {
  /** 短い commit の ID */
  readonly commit: string
  /** commit の日時（ISO 8601） */
  readonly date: string
  /** commit の一言（1 行目） */
  readonly subject: string
}

/** 並べる版の数の既定 */
export const DOC_VERSION_LIMIT = 30
/** 差分として返す最大の大きさ（これを超えたら切って、切ったと書く） */
const MAX_DIFF_CHARS = 200_000
const MAX_BUFFER = 16 * 1024 * 1024
/** 版の名前として受けるのは commit の ID だけ（オプションや範囲の書き方を git に渡さない） */
const COMMIT_ID = /^[0-9a-f]{4,40}$/i

/**
 * その文書を変えた commit を、新しい順に返す（名前を変えた文書は前の名前もたどる）。
 * git の外・commit の無い文書なら空。
 */
export async function docVersions(dir: string, file: string, limit = DOC_VERSION_LIMIT): Promise<DocVersion[]> {
  try {
    const { stdout } = await run('git', ['log', '--follow', `-n${limit}`, '--format=%h%x09%cI%x09%s', '--', file], { cwd: dir, maxBuffer: MAX_BUFFER })
    return stdout.split('\n').filter(Boolean).map(line => {
      const [commit = '', date = '', ...subject] = line.split('\t')
      return { commit, date, subject: subject.join('\t') }
    })
  } catch {
    // git が無い・git 管理外：版は分からない
    return []
  }
}

/**
 * 2 つの版の、その文書だけの差分（unified diff）。to を省けば最後の commit（HEAD）まで。
 * 版の名前が commit の ID の形でなければ断る。
 */
export async function docDiff(dir: string, file: string, from: string, to = 'HEAD'): Promise<string> {
  for (const rev of [from, ...(to === 'HEAD' ? [] : [to])]) {
    if (!COMMIT_ID.test(rev)) throw new Error(t('{rev} is not a commit ID', { rev }))
  }
  const { stdout } = await run('git', ['diff', '--no-color', '--no-ext-diff', from, to, '--', file], { cwd: dir, maxBuffer: MAX_BUFFER })
  return stdout.length > MAX_DIFF_CHARS
    ? `${stdout.slice(0, MAX_DIFF_CHARS)}\n${t('(the diff is too long; the rest is cut. Read it with git diff {from} {to} -- {file})', { from, to, file })}`
    : stdout
}

/**
 * その日時に有効だった版：その日時より前で、いちばん新しい版（versions は新しい順）。
 * 日付だけ（YYYY-MM-DD）なら、その日の終わりまでの commit を含む。読めない日時なら undefined
 */
export function versionAt(versions: readonly DocVersion[], when: string): DocVersion | undefined {
  const at = when.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(at)) return versions.find(v => v.date.slice(0, 10) <= at)
  const time = Date.parse(at)
  if (Number.isNaN(time)) return undefined
  return versions.find(v => Date.parse(v.date) <= time)
}
