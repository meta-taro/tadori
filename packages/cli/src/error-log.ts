import { appendFile, mkdir, readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * tadori serve の中で起きた例外の記録（画面が「サーバーの中で問題が起きました」と出したときに、どこで何が落ちたかを後から確かめるため）。
 * 置くのは PC の手元（案件のフォルダではない。案件の git に記録が混ざらないように）。
 * 残すのは時刻・API・例外の種類と文・呼び出しの頭の数行だけで、送られてきた本文（案件の中身）は残さない。
 */

export interface ServerErrorRecord {
  readonly at: string
  readonly method: string
  readonly path: string
  readonly project: string
  readonly name: string
  readonly message: string
  /** 呼び出しの頭の数行（どのファイルの何行目で落ちたか） */
  readonly stack: readonly string[]
}

const STACK_LINES = 6

/** 記録の置き場所：TADORI_LOG_DIR → OS ごとの手元のログの場所 */
export function defaultLogDir(env: Readonly<Record<string, string | undefined>> = process.env, platform: string = process.platform, home: string = process.env.HOME ?? process.env.USERPROFILE ?? '.'): string {
  if (env.TADORI_LOG_DIR?.trim()) return env.TADORI_LOG_DIR.trim()
  if (platform === 'win32') return join(env.LOCALAPPDATA ?? join(home, 'AppData', 'Local'), 'tadori', 'logs')
  if (platform === 'darwin') return join(home, 'Library', 'Logs', 'tadori')
  return join(env.XDG_STATE_HOME ?? join(home, '.local', 'state'), 'tadori', 'logs')
}

const pad = (n: number) => String(n).padStart(2, '0')
const fileOf = (dir: string, at: Date) => join(dir, `server-${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}.log`)

/** 1 件足して、その記録のファイルの場所を返す（画面に出す） */
export async function appendServerError(dir: string, input: { at?: Date; method: string; path: string; project: string; error: unknown }): Promise<string> {
  const at = input.at ?? new Date()
  const error = input.error instanceof Error ? input.error : new Error(String(input.error))
  const record: ServerErrorRecord = {
    at: at.toISOString(),
    method: input.method,
    path: input.path,
    project: input.project,
    name: error.name,
    message: error.message,
    stack: (error.stack ?? '').split('\n').slice(1, 1 + STACK_LINES).map(l => l.trim()),
  }
  await mkdir(dir, { recursive: true })
  const file = fileOf(dir, at)
  await appendFile(file, `${JSON.stringify(record)}\n`, 'utf8')
  return file
}

/** 新しい順に limit 件まで読む（新しい日のファイルから）。記録が無ければ空 */
export async function readServerErrors(dir: string, limit: number): Promise<ServerErrorRecord[]> {
  let files: string[]
  try {
    files = (await readdir(dir)).filter(f => /^server-\d{4}-\d{2}-\d{2}\.log$/.test(f)).sort().reverse()
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const found: ServerErrorRecord[] = []
  for (const file of files) {
    const lines = (await readFile(join(dir, file), 'utf8')).split('\n').filter(Boolean).reverse()
    for (const line of lines) {
      try {
        found.push(JSON.parse(line) as ServerErrorRecord)
      } catch {
        // 途中で切れた行（書いている最中に止まったなど）は読み飛ばす。ほかの行は読める
      }
      if (found.length >= limit) return found
    }
  }
  return found
}
