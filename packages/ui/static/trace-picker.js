// つながりを辿る：辿り始めの行を探す欄。台帳は数千行になりうるので、全件を並べない
import { esc, kindLabel } from './util.js'

const MAX_RESULTS = 20
let query = ''
let kindFilter = 'all'

/** ID か名前に、打った言葉が全部含まれる行（大文字小文字は区別しない） */
function matches(item, words) {
  const text = `${item.id} ${item.title}`.toLowerCase()
  return words.every(w => text.includes(w))
}

/** 何も打っていないときに出す行：漏れのある行と指摘（辿る意味が大きいもの） */
function suggestions(state) {
  const leakIds = new Set(state.leaks.map(l => l.itemId))
  return state.items.filter(i => leakIds.has(i.id) || i.kind === 'F')
}

function candidates(state) {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const pool = words.length ? state.items.filter(i => matches(i, words)) : suggestions(state)
  return kindFilter === 'all' ? pool : pool.filter(i => i.kind === kindFilter)
}

function resultsHtml(state, startId) {
  const found = candidates(state)
  const leakIds = new Set(state.leaks.map(l => l.itemId))
  const rows = found.slice(0, MAX_RESULTS).map(i => `
    <button type="button" class="pick-row ${i.id === startId ? 'on' : ''}" data-pick="${esc(i.id)}">
      <span class="mono">${esc(i.id)}</span>
      <span class="pick-kind">${esc(kindLabel(i.kind))}</span>
      <span class="pick-title">${esc(i.title)}</span>
      ${leakIds.has(i.id) ? '<span class="chip hole"><span class="dot"></span>漏れ</span>' : ''}
    </button>`).join('')
  const heading = query.trim() ? `「${esc(query.trim())}」に合う行` : '漏れのある行と指摘'
  const rest = found.length > MAX_RESULTS ? `<div class="cond pick-more">ほか ${found.length - MAX_RESULTS} 件。もう少し絞ってください</div>` : ''
  // 漏れも指摘も無い案件では、故障に見えないよう、探せば辿れることを伝える
  const empty = query.trim() || kindFilter !== 'all'
    ? '合う行がありません'
    : '漏れのある行も指摘もありません。ID か名前で探すと、どの行からでも辿れます'
  return `<div class="cond pick-head">${heading} · ${found.length} 件</div>${rows || `<div class="cond pick-more">${empty}</div>`}${rest}`
}

/** 探す欄を描き、選ばれたら onPick(id) を呼ぶ */
export function renderPicker(container, state, startId, onPick) {
  const kinds = [...new Set(state.items.map(i => i.kind))]
  const kindButtons = ['all', ...kinds].map(k => `<button type="button" data-kind="${esc(k)}" aria-pressed="${k === kindFilter}">${k === 'all' ? 'すべて' : esc(kindLabel(k))}</button>`).join('')
  container.innerHTML = `
    <div class="picker-box">
      <input id="pick-query" type="search" placeholder="ID か名前で探す（例：F-02、延滞）" value="${esc(query)}" aria-label="辿り始めの行を探す">
      <div class="seg pick-kinds" role="group" aria-label="種類で絞る">${kindButtons}</div>
      <div class="pick-results" id="pick-results">${resultsHtml(state, startId)}</div>
    </div>`
  const results = container.querySelector('#pick-results')
  const bindRows = () => results.querySelectorAll('[data-pick]').forEach(b => b.addEventListener('click', () => onPick(b.dataset.pick)))
  bindRows()
  // 打つたびに候補だけ描き直す（欄ごと描き直すと、打っている途中で入力が切れる）
  container.querySelector('#pick-query').addEventListener('input', e => {
    query = e.target.value
    results.innerHTML = resultsHtml(state, startId)
    bindRows()
  })
  container.querySelectorAll('[data-kind]').forEach(b => b.addEventListener('click', () => {
    kindFilter = b.dataset.kind
    renderPicker(container, state, startId, onPick)
  }))
}
