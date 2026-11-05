// 用語：glossary.tsv（用語集の正本）を読んで並べる。言葉で絞り込める
import { esc } from './util.js'

let query = ''

/** TSV を読む（# と空行は読み飛ばす。判定の核の parseTsv と同じ決まり） */
function parseTsv(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim() && !l.startsWith('#'))
  const [head, ...body] = lines
  if (!head) return []
  const header = head.split('\t')
  return body.map(line => Object.fromEntries(header.map((h, i) => [h, line.split('\t')[i] ?? ''])))
}

function rowsHtml(entries) {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const shown = entries.filter(e => words.every(w => `${e.term} ${e.meaning} ${e.example}`.toLowerCase().includes(w)))
  const groups = [...new Set(shown.map(e => e.group))]
  if (!groups.length) return '<div class="cond">合う言葉がありません</div>'
  return groups.map(g => `
    <h2>${esc(g)}</h2>
    <div class="panel"><table class="glossary">
      <thead><tr><th style="width:190px">言葉</th><th>意味</th><th style="width:180px">画面のどこ</th><th style="width:240px">例</th></tr></thead>
      <tbody>${shown.filter(e => e.group === g).map(e => `<tr>
        <td class="pair">${esc(e.term)}</td><td>${esc(e.meaning)}</td><td class="cond">${esc(e.where)}</td><td class="cond">${esc(e.example)}</td></tr>`).join('')}</tbody>
    </table></div>`).join('')
}

export async function renderGlossary(view) {
  view.innerHTML = `
    <h1>用語</h1>
    <p class="lede">tadori の画面と文書で使う言葉です。エージェントが画面を説明するときも、この言葉を使います。</p>
    <input id="glossary-query" class="glossary-query" type="search" placeholder="言葉で探す（例：漏れ、タスク）" value="${esc(query)}" aria-label="言葉で探す">
    <div id="glossary-body"><div class="cond">読み込み中…</div></div>`
  const body = view.querySelector('#glossary-body')
  try {
    const res = await fetch('/glossary.tsv')
    if (!res.ok) throw new Error(`用語集を読めませんでした（${res.status}）`)
    const entries = parseTsv(await res.text())
    body.innerHTML = rowsHtml(entries)
    view.querySelector('#glossary-query').addEventListener('input', e => { query = e.target.value; body.innerHTML = rowsHtml(entries) })
  } catch (error) {
    body.innerHTML = `<div class="cond">${esc(error.message)}</div>`
  }
}
