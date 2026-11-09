import { t } from '../i18n.js'

/**
 * ほかの道具（md-business・git-qa など）を開くリンクの雛形。
 * 雛形は案件の .tadori/links.tsv に書く。開いたあとの動きは、その道具の実装に任せる（tadori は URL を作るだけ）。
 */
export interface LinkTemplate {
  /** 道具の名前（例：md-business・git-qa） */
  readonly tool: string
  /** 例：md-business://open?path={path}&line={line} */
  readonly url: string
}

export interface LinkValues {
  /** 案件のフォルダの中の場所（例：ledger/items.tsv） */
  readonly path?: string
  /** git リポジトリの最上位からの場所（例：examples/lend-v12/ledger/items.tsv）。案件が最上位なら path と同じ */
  readonly repopath?: string
  /** 手元の絶対パス */
  readonly abspath?: string
  /** 行番号 */
  readonly line?: number
  /** 行の ID（例：DD-2.3・TC-07） */
  readonly id?: string
}

/** 雛形の差し込み（{path} など）に、URL で崩れない形にした値を入れる。値が無ければ空 */
export function buildLink(template: string, values: LinkValues): string {
  return template.replace(/\{(path|repopath|abspath|line|id)\}/g, (_, key: keyof LinkValues) => {
    const value = values[key]
    return value === undefined ? '' : encodeURIComponent(String(value))
  })
}

/** 押すと画面の中で命令が動く形・手元のファイルを直接開く形は使わない */
const FORBIDDEN_SCHEMES = ['javascript', 'data', 'vbscript', 'file']

/**
 * 雛形を使ってよいかを見る。よければ null、だめなら理由。
 * リポジトリに書く設定なので、他人のリポジトリを開いて押しただけで何かが動くことのないようにする。
 */
export function validateLinkTemplate(template: string): string | null {
  const scheme = template.trim().match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/)?.[1]?.toLowerCase()
  if (!scheme) return t('The URL has no scheme (such as md-business://): {template}', { template })
  if (FORBIDDEN_SCHEMES.includes(scheme)) return t('{scheme}: links are not allowed (clicking one would run code in the screen or open a local file directly)', { scheme })
  return null
}
