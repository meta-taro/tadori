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
  /** md-business の検証シートの行 ID（例 r3f9a2c81b40e）。台帳の TSV の行には無い */
  readonly rowid?: string
}

const PLACEHOLDER = /\{(path|repopath|abspath|line|id|rowid)\}/g

const fill = (text: string, values: LinkValues) => text.replace(PLACEHOLDER, (_, key: keyof LinkValues) => {
  const value = values[key]
  return value === undefined || value === '' ? '' : encodeURIComponent(String(value))
})

/** 引数（「名前=値」）が差し込みを含み、差し込んだ結果の値が空か */
function isEmptyParam(param: string, values: LinkValues): boolean {
  const [, value = ''] = param.split(/=(.*)/s)
  return PLACEHOLDER.test(value) && fill(value, values) === ''
}

/**
 * 雛形の差し込み（{path} など）に、URL で崩れない形にした値を入れる。
 * 値の無い差し込みだけでできた引数（例：行番号の無い行の line=）は、リンクから外す。
 * 空の値を渡すと、開く側が「その値を探す」ことになり、見つからないと知らせが出るため。
 */
export function buildLink(template: string, values: LinkValues): string {
  const at = template.indexOf('?')
  if (at < 0) return fill(template, values)
  const params = template.slice(at + 1).split('&').filter(p => {
    PLACEHOLDER.lastIndex = 0
    return !isEmptyParam(p, values)
  })
  const base = fill(template.slice(0, at), values)
  return params.length ? `${base}?${params.map(p => fill(p, values)).join('&')}` : base
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
