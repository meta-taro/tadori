// 設定：工程とステータス。保存すると TSV に書き戻し、案件が git リポジトリなら commit する
import { t, lang } from './i18n.js'
import { api, ApiError, chip, esc, ICON_INFO, messageOf, toast, toastCommit, within, idPill } from './util.js'

/** @typedef {import('./types').ProjectState} ProjectState */
/** @typedef {import('./types').Phase} Phase */
/**
 * 保存するステータス（色の意味 tone は、サーバーが none・wait・hole・ok かを確かめる）
 * @typedef {{ id: string, name: string, tone: string }} StatusInput
 */

/** @type {Readonly<Record<string, string>>} 色の意味 → 画面での呼び名 */
const TONES = { none: 'No color', wait: 'Blue-gray (in progress)', hole: 'Amber (stuck)', ok: 'Green (done)' }
/** @type {string[]} 保存を断られたときの理由（次に描くときに出す） */
let problems = []

/**
 * 見た目の選び方。案件の設定ではなく、この PC のこの人の好みなので TSV には書かない（theme.js が覚える）
 * @type {Readonly<Record<string, string>>}
 */
const THEMES = { light: 'Light', dark: 'Dark', system: 'Match OS' }

function themeHtml() {
  const current = window.tadoriTheme?.choice() ?? 'light'
  return `<h2>${esc(t('Appearance'))}</h2>
    <div class="seg" role="group" aria-label="${esc(t('Color scheme'))}">${Object.entries(THEMES).map(([k, v]) =>
      `<button type="button" data-theme-choice="${k}" aria-pressed="${k === current}">${esc(t(v))}</button>`).join('')}</div>
    <p class="cond">${esc(t('Applies only to tadori on this PC (not written to the project settings).'))}</p>`
}

/**
 * 一覧の行を並べ替える（元の配列は変えない）
 * @template T
 * @param {readonly T[]} list
 * @param {number} index
 * @param {number} dir
 * @returns {T[]}
 */
const moved = (list, index, dir) => {
  const next = [...list]
  const target = index + dir
  if (target < 0 || target >= next.length) return next
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
}

/**
 * @param {string} path
 * @param {unknown} body
 * @param {string} what
 * @param {() => Promise<void>} reload
 */
async function save(path, body, what, reload) {
  try {
    const { commit } = await api(path, { method: 'PUT', body })
    problems = []
    toastCommit(what, commit)
    await reload()
  } catch (error) {
    problems = error instanceof ApiError && error.problems.length ? error.problems : [messageOf(error)]
    toast(t('Could not save {what}', { what }))
    await reload()
  }
}

/** @param {ProjectState} state */
function phaseRows(state) {
  const used = (/** @type {string} */ id) => [...state.rules.filter(r => r.phase === id).map(r => r.id), ...state.tasks.filter(t => t.phase === id).map(t => t.id)]
  return state.phases.map((p, i) => `<tr>
    <td class="rule-id">${i + 1}</td>
    <td><input class="inline-input" data-phase-name="${esc(p.id)}" value="${esc(p.name)}" aria-label="${esc(t('Name of phase {id}', { id: p.id }))}"></td>
    <td>${idPill(p.id)}</td>
    <td class="cond">${used(p.id).length ? `<span class="count-badge">${esc(t('{n} items', { n: used(p.id).length }))}</span> ${used(p.id).slice(0, 4).map(id => idPill(id)).join('')}${used(p.id).length > 4 ? '<span class="cond">…</span>' : ''}` : esc(t('Not used'))}</td>
    <td class="row-actions">
      <button type="button" class="btn-ghost" data-phase-move="${i}" data-dir="-1" ${i === 0 ? 'disabled' : ''} aria-label="${esc(t('Move up'))}">↑</button>
      <button type="button" class="btn-ghost" data-phase-move="${i}" data-dir="1" ${i === state.phases.length - 1 ? 'disabled' : ''} aria-label="${esc(t('Move down'))}">↓</button>
      <button type="button" class="btn-ghost" data-phase-remove="${esc(p.id)}">${esc(t('Remove'))}</button>
    </td></tr>`).join('')
}

/** @param {ProjectState} state */
function statusRows(state) {
  const toneOptions = (/** @type {string} */ cur) => Object.entries(TONES).map(([k, v]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${esc(t(v))}</option>`).join('')
  return state.statuses.map((s, i) => `<tr>
    <td class="rule-id">${i + 1}</td>
    <td>${chip(s.tone === 'none' ? '' : s.tone, esc(s.name))}</td>
    <td><select class="inline-select" data-status-tone="${esc(s.id)}" aria-label="${esc(t('Color of {name}', { name: s.name }))}">${toneOptions(s.tone)}</select></td>
    <td class="cond">${esc(t('{n} tasks', { n: state.tasks.filter(task => task.status === s.id).length }))}</td>
    <td class="row-actions">
      <button type="button" class="btn-ghost" data-status-move="${i}" data-dir="-1" ${i === 0 ? 'disabled' : ''} aria-label="${esc(t('Move up'))}">↑</button>
      <button type="button" class="btn-ghost" data-status-move="${i}" data-dir="1" ${i === state.statuses.length - 1 ? 'disabled' : ''} aria-label="${esc(t('Move down'))}">↓</button>
      <button type="button" class="btn-ghost" data-status-remove="${esc(s.id)}">${esc(t('Remove'))}</button>
    </td></tr>`).join('')
}

/**
 * @param {HTMLElement} view
 * @param {ProjectState} state
 * @param {() => Promise<void>} reload
 */
export function renderSettings(view, state, reload) {
  view.innerHTML = `
    <h1>${esc(t('Settings'))}</h1>
    <p class="lede">${esc(t('Phase order and statuses differ by company and product. Saving writes them back to the TSV files in {dir} and commits them if the project is a git repository (a person pushes after checking).')).replace('{dir}', '<span class="mono">.tadori/</span>')}</p>
    ${problems.length ? `<div class="note">${ICON_INFO}<span>${problems.map(esc).join('<br>')}</span></div>` : ''}
    ${themeHtml()}
    <h2>${esc(t('Phases · {n}', { n: state.phases.length }))}</h2>
    <div class="panel"><table>
      <thead><tr><th style="width:48px">${esc(t('Order'))}</th><th>${esc(t('Name'))}</th><th style="width:90px">ID</th><th>${esc(t('Used by rules and tasks'))}</th><th style="width:170px"></th></tr></thead>
      <tbody>${phaseRows(state)}</tbody></table>
      <form class="add" id="add-phase">
        <label>${esc(t('ID (letters and digits)'))}<input name="id" required pattern="[A-Za-z0-9_-]+" placeholder="${esc(t('e.g. {id}', { id: 'st' }))}"></label>
        <label>${esc(t('Name'))}<input name="name" required maxlength="20" placeholder="${esc(t('e.g. System test'))}"></label>
        <div class="actions"><button type="submit" class="btn-primary">${esc(t('Add phase'))}</button></div>
      </form></div>
    <h2>${esc(t('WBS statuses · {n}', { n: state.statuses.length }))}</h2>
    <div class="panel"><table>
      <thead><tr><th style="width:48px">${esc(t('Order'))}</th><th>${esc(t('Name'))}</th><th style="width:200px">${esc(t('Color meaning'))}</th><th style="width:96px">${esc(t('Used by tasks'))}</th><th style="width:170px"></th></tr></thead>
      <tbody>${statusRows(state)}</tbody></table>
      <form class="add" id="add-status">
        <label>${esc(t('ID (letters and digits)'))}<input name="id" required pattern="[A-Za-z0-9_-]+" placeholder="${esc(t('e.g. {id}', { id: 'back' }))}"></label>
        <label>${esc(t('Name'))}<input name="name" required maxlength="20" placeholder="${esc(t('e.g. Sent back'))}"></label>
        <label>${esc(t('Color meaning'))}<select name="tone">${Object.entries(TONES).map(([k, v]) => `<option value="${k}">${esc(t(v))}</option>`).join('')}</select></label>
        <div class="actions"><button type="submit" class="btn-primary">${esc(t('Add status'))}</button></div>
      </form></div>`

  // 下の data-* は、どれも直前に描いた要素に付けたもの
  const all = (/** @type {string} */ selector) => /** @type {NodeListOf<HTMLElement>} */ (view.querySelectorAll(selector))
  const inputs = (/** @type {string} */ selector) => /** @type {NodeListOf<HTMLInputElement | HTMLSelectElement>} */ (view.querySelectorAll(selector))

  all('[data-theme-choice]').forEach(b => b.addEventListener('click', () => {
    window.tadoriTheme?.set(b.dataset.themeChoice ?? '')
    all('[data-theme-choice]').forEach(x => x.setAttribute('aria-pressed', String(x === b)))
  }))

  const savePhases = (/** @type {readonly Phase[]} */ list) => save('/api/settings/phases', list.map((p, i) => ({ ...p, order: i + 1 })), t('the phase settings'), reload)
  const saveStatuses = (/** @type {readonly StatusInput[]} */ list) => save('/api/settings/statuses', list, t('the status settings'), reload)

  inputs('[data-phase-name]').forEach(input => input.addEventListener('change', () =>
    savePhases(state.phases.map(p => (p.id === input.dataset.phaseName ? { ...p, name: input.value.trim() } : p)))))
  all('[data-phase-move]').forEach(b => b.addEventListener('click', () =>
    savePhases(moved(state.phases, Number(b.dataset.phaseMove), Number(b.dataset.dir)))))
  all('[data-phase-remove]').forEach(b => b.addEventListener('click', () =>
    savePhases(state.phases.filter(p => p.id !== b.dataset.phaseRemove))))
  const addPhase = /** @type {HTMLFormElement} */ (within(view, '#add-phase'))
  addPhase.addEventListener('submit', e => {
    e.preventDefault()
    const f = new FormData(addPhase)
    savePhases([...state.phases, { id: String(f.get('id')).trim(), name: String(f.get('name')).trim(), order: 0 }])
  })

  inputs('[data-status-tone]').forEach(sel => sel.addEventListener('change', () =>
    saveStatuses(state.statuses.map(s => (s.id === sel.dataset.statusTone ? { ...s, tone: sel.value } : s)))))
  all('[data-status-move]').forEach(b => b.addEventListener('click', () =>
    saveStatuses(moved(state.statuses, Number(b.dataset.statusMove), Number(b.dataset.dir)))))
  all('[data-status-remove]').forEach(b => b.addEventListener('click', () =>
    saveStatuses(state.statuses.filter(s => s.id !== b.dataset.statusRemove))))
  const addStatus = /** @type {HTMLFormElement} */ (within(view, '#add-status'))
  addStatus.addEventListener('submit', e => {
    e.preventDefault()
    const f = new FormData(addStatus)
    saveStatuses([...state.statuses, { id: String(f.get('id')).trim(), name: String(f.get('name')).trim(), tone: String(f.get('tone')) }])
  })
}
