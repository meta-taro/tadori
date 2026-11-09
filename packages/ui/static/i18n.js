// 画面の言葉（英語を基本にし、日本語は辞書で引く）。
// 書くときは英語の文をそのまま鍵にする：t('Gaps {n}', { n: 3 })。日本語の辞書（i18n-ja.js）に無い文は英語のまま出る。
// 言語は、人が選んだもの（この PC に覚える）→ OS / ブラウザの言語（ja なら日本語）→ 英語、の順で決める。
// 案件の中で人が書いた言葉（工程の名前・列の名前・1 日の進行の文など）は訳さない。
import { JA } from './i18n-ja.js'

const LANG_KEY = 'tadori-lang'
/** @typedef {'en' | 'ja'} Lang */
export const LANGS = /** @type {const} */ (['en', 'ja'])

/** @returns {Lang} */
function detect() {
  try {
    const saved = localStorage.getItem(LANG_KEY)
    if (saved === 'en' || saved === 'ja') return saved
  } catch {
    // 覚えられない環境（プライベートなど）では、OS の言語で決める
  }
  const preferred = [...(navigator.languages ?? []), navigator.language].filter(Boolean)
  return preferred.some(l => l.toLowerCase().startsWith('ja')) ? 'ja' : 'en'
}

/** いまの画面の言語 */
export const lang = detect()
document.documentElement.lang = lang

/**
 * 言語を選び直す（この PC に覚えて、画面を読み直す）
 * @param {Lang} next
 */
export function setLang(next) {
  try { localStorage.setItem(LANG_KEY, next) } catch { /* 覚えられなくても、いまの画面は読み直す */ }
  location.reload()
}

/**
 * 画面の文を、いまの言語で返す。{名前} は vars の値で埋める
 * @param {string} text 英語の文（鍵）
 * @param {Readonly<Record<string, string | number>>} [vars]
 */
export function t(text, vars) {
  const base = lang === 'ja' ? (JA[text] ?? text) : text
  return vars ? base.replace(/\{(\w+)\}/g, (all, name) => (name in vars ? String(vars[name]) : all)) : base
}

/** 画面の骨組み（index.html）の data-i18n・data-i18n-title・data-i18n-placeholder・data-i18n-label を訳す */
export function translateDocument(root = document) {
  root.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.getAttribute('data-i18n') ?? '') })
  root.querySelectorAll('[data-i18n-title]').forEach(el => el.setAttribute('title', t(el.getAttribute('data-i18n-title') ?? '')))
  root.querySelectorAll('[data-i18n-placeholder]').forEach(el => el.setAttribute('placeholder', t(el.getAttribute('data-i18n-placeholder') ?? '')))
  root.querySelectorAll('[data-i18n-label]').forEach(el => el.setAttribute('aria-label', t(el.getAttribute('data-i18n-label') ?? '')))
}

/** 用語集の見出し（glossary.tsv の group は日本語で書いてある）の英語 */
/** @type {Readonly<Record<string, string>>} */
const GLOSSARY_GROUPS_EN = { WBS: 'WBS', ルール: 'Rules', 全体: 'General', 台帳: 'Ledger', 案件による: 'Per project', 結果: 'Results', 試験: 'Testing' }

/**
 * 用語集（glossary.tsv）の 1 行を、いまの言語の列で返す。英語なら term_en などを使い（空なら日本語のまま）、
 * 見出し（group は日本語で書いてある）は辞書で訳す
 * @param {Readonly<Record<string, string>>} row
 * @returns {Record<string, string>}
 */
export function glossaryRow(row) {
  if (lang !== 'en') return { ...row }
  return {
    ...row,
    group: GLOSSARY_GROUPS_EN[row.group ?? ''] ?? row.group ?? '',
    term: row.term_en || row.term || '',
    meaning: row.meaning_en || row.meaning || '',
    where: row.where_en || row.where || '',
    example: row.example_en || row.example || '',
  }
}
