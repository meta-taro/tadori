import { execFile } from 'node:child_process'
import { realpath } from 'node:fs/promises'
import { promisify } from 'node:util'

const run = promisify(execFile)

export interface CommitResult {
  readonly committed: boolean
  /** commit しなかった理由（画面とエージェントにそのまま見せる） */
  readonly reason?: string
}

/** 案件のフォルダが、それ自身の git リポジトリの最上位か */
async function isOwnRepository(dir: string): Promise<boolean> {
  try {
    const { stdout } = await run('git', ['rev-parse', '--show-toplevel'], { cwd: dir })
    return (await realpath(stdout.trim())) === (await realpath(dir))
  } catch {
    // git が無い・git 管理外のどちらでも「自分のリポジトリではない」として扱う
    return false
  }
}

/**
 * 変えたファイルだけを commit する。push はしない（人が中身を確かめてから push するため）。
 * 案件がそれ自身の git リポジトリでなければ commit しない（別のリポジトリに記録が混ざるのを防ぐ）。
 */
export async function commitFiles(dir: string, files: readonly string[], message: string): Promise<CommitResult> {
  if (!(await isOwnRepository(dir))) {
    return { committed: false, reason: 'この案件のフォルダは、それ自身の git リポジトリではないので commit していません' }
  }
  try {
    await run('git', ['add', '--', ...files], { cwd: dir })
    const { stdout } = await run('git', ['diff', '--cached', '--name-only', '--', ...files], { cwd: dir })
    if (!stdout.trim()) return { committed: false, reason: '変更が無いので commit していません' }
    await run('git', ['commit', '-q', '-m', `chore(tadori): ${message}`, '--', ...files], { cwd: dir })
    return { committed: true }
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message.split('\n').at(0) : String(error)
    return { committed: false, reason: `git commit に失敗しました：${detail}` }
  }
}
