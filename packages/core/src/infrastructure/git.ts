import { execFile } from 'node:child_process'
import { realpath } from 'node:fs/promises'
import { promisify } from 'node:util'

const run = promisify(execFile)

export interface CommitResult {
  readonly committed: boolean
  /** commit しなかった理由（画面とエージェントにそのまま見せる） */
  readonly reason?: string
  /** commit したあと、push していない commit の数。push 先が設定されていなければ null */
  readonly unpushed?: number | null
}

/** push していない commit の数（push 先が無ければ null）。tadori は push しない。人に知らせるためだけに数える */
async function unpushedCount(dir: string): Promise<number | null> {
  try {
    const { stdout } = await run('git', ['rev-list', '--count', '@{upstream}..HEAD'], { cwd: dir })
    return Number(stdout.trim())
  } catch {
    // push 先（upstream）が設定されていないクローン・ブランチ
    return null
  }
}

/**
 * 案件のフォルダが git リポジトリの最上位から見てどこにあるか（例：`examples/lend/`）。
 * 最上位そのもの・git の外なら空。ほかの道具に「リポジトリの中のどのファイルか」を渡すために使う。
 */
export async function repositoryPrefix(dir: string): Promise<string> {
  try {
    const { stdout } = await run('git', ['rev-parse', '--show-prefix'], { cwd: dir })
    return stdout.trim()
  } catch {
    // git が無い・git 管理外：案件のフォルダを最上位とみなす
    return ''
  }
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
    return { committed: true, unpushed: await unpushedCount(dir) }
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message.split('\n').at(0) : String(error)
    return { committed: false, reason: `git commit に失敗しました：${detail}` }
  }
}
