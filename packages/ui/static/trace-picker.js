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
/** 行のいまの状態：漏れ（いま漏れがある）・対応済み（前のチェックでは漏れ、いまは無い）・漏れなし */
function statusOf(state, id) {
  if (state.leaks.some(l => l.itemId === id)) return 'leak'
  if ((state.resolved ?? []).some(r => r.itemId === id)) return 'resolved'
  return 'ok'
}

const BADGES = {
  leak: '<span class="chip hole"><span class="dot"></span>漏れ</span>',
  resolved: '<span class="chip ok"><span class="dot"></span>対応済み</span>',
  ok: '<span class="chip pick-ok">✓ 漏れなし</span>',
}

function rowHtml(state, item, startId) {
  return `<button type="button" class="pick-row ${item.id === startId ? 'on' : ''}" data-pick="${esc(item.id)}">
      <span class="mono">${esc(item.id)}</span>
      <span class="pick-kind">${esc(kindLabel(item.kind))}</span>
      ${BADGES[statusOf(state, item.id)]}
      <span class="pick-title">${esc(item.title)}</span>
    </button>`
}

/** 何も打っていないときの初期表示：漏れのある行・対応済み・指摘の 3 つに分けて並べる */
function suggestionGroups(state) {
  const byKind = i => kindFilter === 'all' || i.kind === kindFilter
  const leak = state.items.filter(i => byKind(i) && statusOf(state, i.id) === 'leak')
  const resolved = state.items.filter(i => byKind(i) && statusOf(state, i.id) === 'resolved')
  const shown = new Set([...leak, ...resolved].map(i => i.id))
  const findings = state.items.filter(i => byKind(i) && i.kind === 'F' && !shown.has(i.id))
  return [
    { heading: '漏れのある行', items: leak, tone: 'leak' },
    { heading: '対応済み（前のチェックでは漏れ）', items: resolved, tone: 'resolved' },
    { heading: '指摘', items: findings, tone: 'finding' },
  ].filter(g => g.items.length)
}

function resultsHtml(state, startId) {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const groups = words.length
    ? [{ heading: `「${esc(query.trim())}」に合う行`, items: state.items.filter(i => matches(i, words) && (kindFilter === 'all' || i.kind === kindFilter)) }]
    : suggestionGroups(state)
  if (!groups.some(g => g.items.length)) {
    // 漏れも指摘も無い案件では、故障に見えないよう、探せば辿れることを伝える
    const empty = words.length || kindFilter !== 'all' ? '合う行がありません' : '漏れのある行も指摘もありません。ID か名前で探すと、どの行からでも辿れます'
    return `<div class="cond pick-more">${empty}</div>`
  }
  return groups.map(g => {
    const rest = g.items.length > MAX_RESULTS ? `<div class="cond pick-more">ほか ${g.items.length - MAX_RESULTS} 件。もう少し絞ってください</div>` : ''
    return `<div class="pick-head tone-${g.tone ?? 'search'}"><span>${g.heading}</span><span class="pick-count">${g.items.length} 件</span></div>${g.items.slice(0, MAX_RESULTS).map(i => rowHtml(state, i, startId)).join('')}${rest}`
  }).join('')
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
