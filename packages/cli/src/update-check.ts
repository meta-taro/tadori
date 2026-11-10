/**
 * 新しい版があるかを確かめる（ヘルプの「バージョンと更新」と、起動したときの確認が使う）。
 * 見るのは GitHub の公開リリースの「最新」だけで、案件の中身や手元の情報は送らない。
 * 入れ替えはしない。新しい版があれば、配布のページを開けるようにするだけ。
 */
import './i18n.js'
import { t } from '@tadori/core'

const LATEST_RELEASE = 'https://api.github.com/repos/meta-taro/tadori/releases/latest'
export const DOWNLOAD_PAGE = 'https://meta-taro.github.io/tadori/download.html'
const LATEST_RELEASE_PAGE = 'https://github.com/meta-taro/tadori/releases/latest'
const TIMEOUT_MS = 8000

export interface UpdateInfo {
  readonly current: string
  readonly latest: string
  readonly isNewer: boolean
  /** その版のリリースのページ（変わったこと） */
  readonly releaseUrl: string
  /** OS と CPU に合うインストーラーを選べるページ */
  readonly downloadUrl: string
  /** 手元でソースから組んだ版（配った版の番号と比べない） */
  readonly isSourceBuild?: boolean
}

/** 手元でソースから組んだ版の答え。新しい版があるとは言わない（git pull で新しくするもの） */
export function sourceBuildInfo(current: string): UpdateInfo {
  return { current, latest: '', isNewer: false, isSourceBuild: true, releaseUrl: LATEST_RELEASE_PAGE, downloadUrl: DOWNLOAD_PAGE }
}

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>

const parts = (version: string) => version.trim().replace(/^v/i, '').split(/[.+-]/).slice(0, 3).map(n => Number.parseInt(n, 10) || 0)

/** a が b より新しい版か（major.minor.patch を数字で比べる） */
export function isNewer(a: string, b: string): boolean {
  const [x, y] = [parts(a), parts(b)]
  for (let i = 0; i < 3; i += 1) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0)
  }
  return false
}

/** いまの版と、公開されている最新の版を比べる。確かめられなければ、そう言って断る（「最新」と決めつけない） */
export async function checkUpdate(current: string, fetcher: Fetcher = fetch): Promise<UpdateInfo> {
  let body: { tag_name?: unknown; html_url?: unknown }
  try {
    const res = await fetcher(LATEST_RELEASE, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'tadori-update-check' }, signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!res.ok) throw new Error(t('GitHub returned {status}', { status: res.status }))
    body = (await res.json()) as typeof body
  } catch (error: unknown) {
    throw new Error(t('Could not check for a new version ({reason}). Check your network connection', { reason: error instanceof Error ? error.message : String(error) }))
  }
  if (typeof body.tag_name !== 'string' || !body.tag_name.trim()) throw new Error(t('Could not check for a new version (the release version is unreadable)'))
  const latest = body.tag_name.trim().replace(/^v/i, '')
  const releaseUrl = typeof body.html_url === 'string' && body.html_url.startsWith('https://github.com/') ? body.html_url : DOWNLOAD_PAGE
  return { current, latest, isNewer: isNewer(latest, current), releaseUrl, downloadUrl: DOWNLOAD_PAGE }
}
