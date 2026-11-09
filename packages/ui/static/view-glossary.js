// 用語：glossary.tsv（用語集の正本）を読んで並べる。言葉で絞り込める
import { glossaryRow, t } from './i18n.js'
import { esc, messageOf } from './util.js'

let query = ''

/**
 * TSV を読む（# と空行は読み飛ばす。判定の核の parseTsv と同じ決まり）
 * @param {string} text
 * @returns {Array<Record<string, string>>} 列名 → 値
 */
function parseTsv(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim() && !l.startsWith('#'))
  const [head, ...body] = lines
  if (!head) return []
  const header = head.split('\t')
  // いまの言語の列（英語なら term_en など）で返す
  return body.map(line => glossaryRow(Object.fromEntries(header.map((h, i) => [h, line.split('\t')[i] ?? '']))))
}

/** @param {ReadonlyArray<Record<string, string>>} entries */
function rowsHtml(entries) {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const shown = entries.filter(e => words.every(w => `${e.term} ${e.meaning} ${e.example}`.toLowerCase().includes(w)))
  const groups = [...new Set(shown.map(e => e.group))]
  if (!groups.length) return `<div class="cond">${esc(t('No matching terms'))}</div>`
  return groups.map(g => `
    <h2>${esc(g)}</h2>
    <div class="panel"><table class="glossary">
      <thead><tr><th style="width:190px">${esc(t('Term'))}</th><th>${esc(t('Meaning'))}</th><th style="width:180px">${esc(t('Where on screen'))}</th><th style="width:240px">${esc(t('Example'))}</th></tr></thead>
      <tbody>${shown.filter(e => e.group === g).map(e => `<tr>
        <td class="pair">${esc(e.term)}</td><td>${esc(e.meaning)}</td><td class="cond">${esc(e.where)}</td><td class="cond">${esc(e.example)}</td></tr>`).join('')}</tbody>
    </table></div>`).join('')
}

/** @param {HTMLElement} view */
export async function renderGlossary(view) {
  view.innerHTML = `
    <h1>${esc(t('Glossary'))}</h1>
    <p class="lede">${esc(t('The words used in the tadori screens and documents. The agent uses the same words when it explains the screen.'))}</p>
    <input id="glossary-query" class="glossary-query" type="search" placeholder="${esc(t('Search terms (e.g. gap, task)'))}" value="${esc(query)}" aria-label="${esc(t('Search terms'))}">
    <div id="glossary-body"><div class="cond">${esc(t('Loading…'))}</div></div>`
  // 直前に描いた中にかならずある
  const body = /** @type {HTMLElement} */ (view.querySelector('#glossary-body'))
  try {
    const res = await fetch('/glossary.tsv')
    if (!res.ok) throw new Error(t('Could not read the glossary ({status})', { status: res.status }))
    const entries = parseTsv(await res.text())
    body.innerHTML = rowsHtml(entries)
    const queryInput = /** @type {HTMLInputElement} */ (view.querySelector('#glossary-query'))
    queryInput.addEventListener('input', () => { query = queryInput.value; body.innerHTML = rowsHtml(entries) })
  } catch (error) {
    body.innerHTML = `<div class="cond">${esc(messageOf(error))}</div>`
  }
}

/** 検索から開くとき、その言葉で絞った状態にする */
/** @param {string} value */
export function setGlossaryQuery(value) {
  query = value
}
