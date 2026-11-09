import { addJapanese, currentLang } from '@tadori/core'
import { JA_CLI } from './i18n-ja.js'

/**
 * CLI・server・MCP の言葉の日本語の辞書を、core の辞書に足す（1 回だけ。言葉を出す部品はどれもこのファイルを先に読む）。
 * 文の組み立て方そのもの（t・withLang など）は core の i18n.ts にある。
 */
addJapanese(JA_CLI)

/** 並べるときの区切り（日本語は「・」、英語は「, 」） */
export const listJoin = (items: readonly string[]): string => items.join(currentLang() === 'ja' ? '・' : ', ')

/** 補足の 1 行の中の区切り（日本語は「／」、英語は「 / 」） */
export const noteJoin = (items: readonly string[]): string => items.join(currentLang() === 'ja' ? '／' : ' / ')

/** 2 つの文をつなぐ（日本語は間を空けない、英語は空白を 1 つ。後ろが空なら前だけ） */
export const joinWords = (before: string, after: string): string => (after ? `${before}${currentLang() === 'ja' ? '' : ' '}${after}` : before)
