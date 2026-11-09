import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * いま動いている server を建てた時刻と commit（packages/cli/scripts/build-info.mjs が dist に残す）。
 * 元のコード（src）が建てた時刻より新しければ isStale。直したのに建て直していない server が、
 * 新しい画面と食い違って落ちるのを、画面で知らせるため。配る版（src が無い）では isStale にしない。
 */
export interface BuildInfo {
  readonly builtAt: string
  readonly commit: string
  readonly isStale: boolean
}

async function newestMtime(dir: string): Promise<number> {
  let newest = 0
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return 0 // 元のコードが無い（配る版）
  }
  for (const entry of entries) {
    const path = join(dir, entry.name)
    const time = entry.isDirectory() ? await newestMtime(path) : (await stat(path)).mtimeMs
    if (time > newest) newest = time
  }
  return newest
}

/** distDir の build-info.json を読み、sourceDirs（cli・core の src）が建てた時刻より新しいかを見る */
export async function readBuildInfo(distDir: string, sourceDirs: readonly string[]): Promise<BuildInfo> {
  let info: { builtAt?: unknown; commit?: unknown }
  try {
    info = JSON.parse(await readFile(join(distDir, 'build-info.json'), 'utf8')) as typeof info
  } catch {
    return { builtAt: '', commit: '', isStale: false }
  }
  const builtAt = typeof info.builtAt === 'string' ? info.builtAt : ''
  const commit = typeof info.commit === 'string' ? info.commit : ''
  const built = Date.parse(builtAt)
  if (Number.isNaN(built)) return { builtAt, commit, isStale: false }
  const newest = Math.max(0, ...(await Promise.all(sourceDirs.map(newestMtime))))
  return { builtAt, commit, isStale: newest > built }
}
