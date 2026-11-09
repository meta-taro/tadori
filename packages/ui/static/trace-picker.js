// つながりを辿る：辿り始めの行を探す欄。台帳は数千行になりうるので、全件を並べない
import { t } from './i18n.js'
import { esc, isMine, kindLabel } from './util.js'

/** @typedef {import('./types').ProjectState} ProjectState */
/** @typedef {import('./types').Item} Item */
/** @typedef {'leak' | 'resolved' | 'ok'} RowStatus */
/**
 * 候補のまとまり（見出しと行）。tone は見出しの色（探したときは無い）
 * @typedef {{ heading: string, items: Item[], tone?: string }} PickGroup
 */

const MAX_RESULTS = 20
let query = ''
let kindFilter = 'all'

/**
 * ID か名前に、打った言葉が全部含まれる行（大文字小文字は区別しない）
 * @param {Item} item
 * @param {string[]} words
 */
function matches(item, words) {
  const text = `${item.id} ${item.title}`.toLowerCase()
  return words.every(w => text.includes(w))
}

/** 何も打っていないときに出す行：漏れのある行と指摘（辿る意味が大きいもの） */
/**
 * 行のいまの状態：漏れ（いま漏れがある）・対応済み（前のチェックでは漏れ、いまは無い）・漏れなし
 * @param {ProjectState} state
 * @param {string} id
 * @returns {RowStatus}
 */
function statusOf(state, id) {
  if (state.leaks.some(l => l.itemId === id)) return 'leak'
  if ((state.resolved ?? []).some(r => r.itemId === id)) return 'resolved'
  return 'ok'
}

/** @type {Record<RowStatus, () => string>} */
const BADGES = {
  leak: () => `<span class="chip hole"><span class="dot"></span>${esc(t('Gap'))}</span>`,
  resolved: () => `<span class="chip ok"><span class="dot"></span>${esc(t('Resolved'))}</span>`,
  ok: () => `<span class="chip pick-ok">✓ ${esc(t('No gaps'))}</span>`,
}

/**
 * @param {ProjectState} state
 * @param {Item} item
 * @param {string} startId
 */
function rowHtml(state, item, startId) {
  return `<button type="button" class="pick-row ${item.id === startId ? 'on' : ''}" data-pick="${esc(item.id)}">
      <span class="mono">${esc(item.id)}</span>
      <span class="pick-kind">${esc(kindLabel(item.kind))}</span>
      ${BADGES[statusOf(state, item.id)]()}
      <span class="pick-title">${esc(item.title)}</span>
    </button>`
}

/**
 * 何も打っていないときの初期表示：漏れのある行・対応済み・指摘の 3 つに分けて並べる
 * @param {ProjectState} state
 * @returns {PickGroup[]}
 */
function suggestionGroups(state) {
  const byKind = (/** @type {Item} */ i) => kindFilter === 'all' || i.kind === kindFilter
  // 漏れのある行は、上の帯の担当の分（漏れを直す担当がその人か、その人の役割）だけにする
  const leak = state.items.filter(i => byKind(i) && statusOf(state, i.id) === 'leak'
    && state.leaks.some(l => l.itemId === i.id && isMine(state, l.owner)))
  const resolved = state.items.filter(i => byKind(i) && statusOf(state, i.id) === 'resolved')
  const shown = new Set([...leak, ...resolved].map(i => i.id))
  const findings = state.items.filter(i => byKind(i) && i.kind === 'F' && !shown.has(i.id))
  return [
    { heading: esc(t('Rows with gaps')), items: leak, tone: 'leak' },
    { heading: esc(t('Resolved (a gap at the previous check)')), items: resolved, tone: 'resolved' },
    { heading: esc(t('Findings')), items: findings, tone: 'finding' },
  ].filter(g => g.items.length)
}

/**
 * @param {ProjectState} state
 * @param {string} startId
 */
function resultsHtml(state, startId) {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  /** @type {PickGroup[]} */
  const groups = words.length
    ? [{ heading: esc(t('Rows matching “{query}”', { query: query.trim() })), items: state.items.filter(i => matches(i, words) && (kindFilter === 'all' || i.kind === kindFilter)) }]
    : suggestionGroups(state)
  if (!groups.some(g => g.items.length)) {
    // 漏れも指摘も無い案件では、故障に見えないよう、探せば辿れることを伝える
    const empty = esc(words.length || kindFilter !== 'all' ? t('No matching rows') : t('No rows with gaps and no findings. Search by ID or name to trace from any row.'))
    return `<div class="cond pick-more">${empty}</div>`
  }
  return groups.map(g => {
    const rest = g.items.length > MAX_RESULTS ? `<div class="cond pick-more">${esc(t('{n} more. Narrow the search.', { n: g.items.length - MAX_RESULTS }))}</div>` : ''
    return `<div class="pick-head tone-${g.tone ?? 'search'}"><span>${g.heading}</span><span class="pick-count">${esc(t('{n} rows', { n: g.items.length }))}</span></div>${g.items.slice(0, MAX_RESULTS).map(i => rowHtml(state, i, startId)).join('')}${rest}`
  }).join('')
}

/**
 * 探す欄を描き、選ばれたら onPick(id) を呼ぶ
 * @param {HTMLElement} container
 * @param {ProjectState} state
 * @param {string} startId
 * @param {(id: string) => void} onPick
 */
export function renderPicker(container, state, startId, onPick) {
  const kinds = [...new Set(state.items.map(i => i.kind))]
  const kindButtons = ['all', ...kinds].map(k => `<button type="button" data-kind="${esc(k)}" aria-pressed="${k === kindFilter}">${k === 'all' ? esc(t('All')) : esc(kindLabel(k))}</button>`).join('')
  container.innerHTML = `
    <div class="picker-box">
      <input id="pick-query" type="search" placeholder="${esc(t('Search by ID or name (e.g. F-02, overdue)'))}" value="${esc(query)}" aria-label="${esc(t('Find the row to trace from'))}">
      <div class="seg pick-kinds" role="group" aria-label="${esc(t('Filter by kind'))}">${kindButtons}</div>
      <div class="pick-results" id="pick-results">${resultsHtml(state, startId)}</div>
    </div>`
  // どちらも直前に描いた中にかならずある
  const results = /** @type {HTMLElement} */ (container.querySelector('#pick-results'))
  const queryInput = /** @type {HTMLInputElement} */ (container.querySelector('#pick-query'))
  const bindRows = () => results.querySelectorAll('[data-pick]').forEach(b => b.addEventListener('click', () => onPick(/** @type {HTMLElement} */ (b).dataset.pick ?? '')))
  bindRows()
  // 打つたびに候補だけ描き直す（欄ごと描き直すと、打っている途中で入力が切れる）
  queryInput.addEventListener('input', () => {
    query = queryInput.value
    results.innerHTML = resultsHtml(state, startId)
    bindRows()
  })
  container.querySelectorAll('[data-kind]').forEach(b => b.addEventListener('click', () => {
    kindFilter = /** @type {HTMLElement} */ (b).dataset.kind ?? 'all'
    renderPicker(container, state, startId, onPick)
  }))
}
