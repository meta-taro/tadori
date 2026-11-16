/**
 * forbidden ルールの語。案件の rulesets の values 列に「|」で並べて書く。
 * ふつうの語は、大文字・小文字を問わずに含むかを見る。/…/（あとに i を付けてもよい）で囲んだものは正規表現として見る。
 * 語の一覧は案件の側に置く（tadori は案件の語を持たない）
 */

/** 書いた語を、当てる形にする。正規表現が読めなければ、その理由を返す */
export function compileWord(word: string): RegExp | { readonly error: string } {
  const regex = /^\/(.+)\/(i?)$/.exec(word)
  if (!regex) return new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
  try {
    return new RegExp(regex[1] ?? '', regex[2] ?? '')
  } catch (error: unknown) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

/** 値の中で最初に当たった語（当たった部分の文字のまま）。当たらなければ undefined */
export function firstForbidden(value: string, words: readonly string[]): string | undefined {
  for (const word of words) {
    const pattern = compileWord(word)
    if (!(pattern instanceof RegExp)) continue
    const hit = pattern.exec(value)
    if (hit) return hit[0]
  }
  return undefined
}
