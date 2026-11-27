import { spawn } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { extname } from 'node:path'
import { loadProject, t } from '@tadori/core'
import { loadDaily } from './daily.js'
import { isLocalRef, localPathOf } from './local-ref.js'
export { isLocalRef, localPathOf }

/**
 * 手元のフォルダ・ファイルを開くリンク（links に file:/// の URL か C:\ で始まる Windows のパスを書いたもの）。
 * ブラウザは http のページから file: を開かせないので、手元で動いている tadori の server が OS に開かせる。
 * 外のページから任意の場所を開かせないよう、画面から受けるのは「台帳のどの行の何本目のリンクか」だけで、パスそのものは受けない
 */

/** 開いてよいファイルの種類（文書・表・画像）。実行ファイル・ショートカット・スクリプトは開かない */
export const OPENABLE_EXTENSIONS = ['.pdf', '.xlsx', '.xls', '.xlsm', '.docx', '.doc', '.pptx', '.ppt', '.csv', '.tsv', '.txt', '.md', '.png', '.jpg', '.jpeg'] as const

export class OpenLocalError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message)
  }
}

/** 開いてよいか（あるか・フォルダか決まった種類のファイルか）を確かめる。だめなら理由つきで止める */
export async function assertOpenable(path: string): Promise<void> {
  let info
  try {
    info = await stat(path)
  } catch {
    throw new OpenLocalError(t('The folder or file was not found on this PC: {path}', { path }), 404)
  }
  if (info.isDirectory()) return
  const ext = extname(path).toLowerCase()
  if (!info.isFile() || !(OPENABLE_EXTENSIONS as readonly string[]).includes(ext)) {
    throw new OpenLocalError(t('tadori opens only folders and these kinds of files: {list}', { list: OPENABLE_EXTENSIONS.join(' ') }))
  }
}

/** OS に開かせる（Windows はエクスプローラー、mac は Finder、ほかは xdg-open）。シェルは通さない */
export type Opener = (path: string) => Promise<void>
export const systemOpener: Opener = path => new Promise((resolve, reject) => {
  const [command, args] = process.platform === 'win32' ? ['explorer.exe', [path]] : process.platform === 'darwin' ? ['open', [path]] : ['xdg-open', [path]]
  const child = spawn(command, args, { detached: true, stdio: 'ignore', shell: false, windowsHide: false })
  child.once('error', reject)
  child.once('spawn', () => { child.unref(); resolve() })
})

/** 画面から受けるリンクの指し方：WBS の作業の何本目か、その日の 1 日の進行の行の何本目か */
export type LocalLinkRef =
  | { readonly kind: 'task'; readonly id: string; readonly index: number }
  | { readonly kind: 'daily'; readonly date: string; readonly entry: string; readonly index: number }

export function parseLocalLinkRef(body: unknown): LocalLinkRef {
  const value = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>
  const index = Number(value.index)
  if (!Number.isInteger(index) || index < 0 || index > 50) throw new OpenLocalError(t('index must be the position of the link (0 or more)'))
  if (value.kind === 'task' && typeof value.id === 'string' && value.id) return { kind: 'task', id: value.id, index }
  if (value.kind === 'daily' && typeof value.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.date) && typeof value.entry === 'string' && value.entry) {
    return { kind: 'daily', date: value.date, entry: value.entry, index }
  }
  throw new OpenLocalError(t('Say which link to open: { "kind": "task", "id", "index" } or { "kind": "daily", "date", "entry", "index" }'))
}

/** 台帳に書いてあるリンクを引き、手元のものなら確かめてから OS に開かせる。開いたパスを返す */
export async function openLocalLink(dir: string, ref: LocalLinkRef, opener: Opener = systemOpener): Promise<string> {
  const links = ref.kind === 'task'
    ? (await loadProject(dir)).tasks.find(task => task.id === ref.id)?.links
    : (await loadDaily(dir, ref.date)).entries.find(e => e.id === ref.entry)?.links
  const link = links?.[ref.index]
  if (!link) throw new OpenLocalError(t('That link is not in the ledger'), 404)
  const path = isLocalRef(link.url) ? localPathOf(link.url) : undefined
  if (!path) throw new OpenLocalError(t('That link is not a folder or file on this PC (network paths are not opened)'))
  await assertOpenable(path)
  await opener(path)
  return path
}
