import { AsyncLocalStorage } from 'node:async_hooks'
import { JA } from './i18n-ja.js'

/**
 * tadori が出す言葉（誤りの文・案内・既定の見出し）。英語を基本にし、日本語は辞書（i18n-ja.ts）で引く。
 * 書くときは英語の文をそのまま鍵にする：t('{id} is not in the ledger', { id })。辞書に無い文は英語のまま出る。
 *
 * 言語は、画面からの 1 回の頼みごとに決められる（withLang。画面で選んだ言語を、その頼みの間だけ使う）。
 * 決めていなければ、TADORI_LANG → OS の言語（ja なら日本語）→ 英語。
 * 案件の中で人が書いた言葉（工程の名前・列の名前など）は訳さない。
 */
export type Lang = 'en' | 'ja'
export const LANGS: readonly Lang[] = ['en', 'ja']

const isLang = (value: unknown): value is Lang => value === 'en' || value === 'ja'

/** 言語の名前（ja・ja-JP・ja_JP.UTF-8 など）を tadori の言語にする。分からなければ undefined */
export function langOf(value: string | undefined | null): Lang | undefined {
  const text = (value ?? '').trim().toLowerCase()
  if (!text) return undefined
  if (text.startsWith('ja')) return 'ja'
  if (text.startsWith('en')) return 'en'
  return undefined
}

/** TADORI_LANG → OS の言語（LC_ALL・LANG・Intl）→ 英語 */
export function detectLang(env: Readonly<Record<string, string | undefined>> = process.env): Lang {
  const explicit = langOf(env.TADORI_LANG)
  if (explicit) return explicit
  for (const name of ['LC_ALL', 'LC_MESSAGES', 'LANG']) {
    const fromEnv = langOf(env[name])
    if (fromEnv) return fromEnv
  }
  return langOf(Intl.DateTimeFormat().resolvedOptions().locale) ?? 'en'
}

let processLang: Lang = detectLang()
/** 日本語の辞書（core の辞書に、CLI などが自分の辞書を足す） */
let ja: Record<string, string> = { ...JA }

/** 日本語の辞書を足す（CLI の言葉など。同じ鍵は後から足したほうを使う） */
export function addJapanese(dictionary: Readonly<Record<string, string>>): void {
  ja = { ...ja, ...dictionary }
}
const requestLang = new AsyncLocalStorage<Lang>()

/** この処理（CLI・MCP・server）の既定の言語を決める */
export function setLang(lang: Lang): void {
  processLang = lang
}

/** いまの言語（画面からの頼みの中なら、その頼みの言語） */
export function currentLang(): Lang {
  return requestLang.getStore() ?? processLang
}

/** fn の間だけ、言語を lang にする（画面からの 1 回の頼みごと） */
export function withLang<T>(lang: Lang | undefined, fn: () => T): T {
  return isLang(lang) ? requestLang.run(lang, fn) : fn()
}

/**
 * 文の中に並べる ID などの一覧をつなぐ。英語は「, 」、日本語は jaSeparator（既定は「・」）
 * （並べる値そのものは訳さない。区切りだけを言語に合わせる）
 */
export function joinList(values: readonly string[], jaSeparator = '・'): string {
  return values.join(currentLang() === 'ja' ? jaSeparator : ', ')
}

/**
 * いまの言語の文にする。{名前} は vars の値で埋める
 * @param text 英語の文（鍵）
 */
export function t(text: string, vars?: Readonly<Record<string, string | number>>): string {
  const base = currentLang() === 'ja' ? (ja[text] ?? text) : text
  return vars ? base.replace(/\{(\w+)\}/g, (all, name: string) => (name in vars ? String(vars[name]) : all)) : base
}
