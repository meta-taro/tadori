// 案件の一覧：いま開いている案件と最近の案件ごとに、漏れ・承認待ち・遅れているタスク・今日が期日のタスク。
// 合計や順位は出さない（何を急ぐかは人が決める）。並びは最近の案件の順のまま
import { t } from './i18n.js'
import { api, chip, esc, messageOf, toast } from './util.js'

/** @typedef {{ id: string, name: string, phase: string, owner?: string }} TaskFact */
/** @typedef {{ name: string, leaks: number, pendingApprovals: number, late: Array<TaskFact & { days: number }>, dueToday: TaskFact[] }} ProjectSummary */
/** @typedef {{ dir: string, current: boolean, summary?: ProjectSummary, problem?: string }} ProjectEntry */

const ownerText = (/** @type {string | undefined} */ owner) => (owner ? t(' ({owner})', { owner }) : '')

/** @param {ProjectSummary} s */
function factsHtml(s) {
  const late = s.late.map(x => `<li class="pj-late">${esc(t('Late {days} days: {id} {name}{owner}', { days: x.days, id: x.id, name: x.name, owner: ownerText(x.owner) }))}</li>`)
  const due = s.dueToday.map(x => `<li class="pj-due">${esc(t('Due today: {id} {name}{owner}', { id: x.id, name: x.name, owner: ownerText(x.owner) }))}</li>`)
  const tasks = [...late, ...due].join('')
  return `<div class="pj-counts">${chip(s.leaks ? 'hole' : 'ok', esc(t('Gaps: {n}', { n: s.leaks })))}${chip(s.pendingApprovals ? 'wait' : 'ok', esc(t('Pending approvals: {n}', { n: s.pendingApprovals })))}</div>
    ${tasks ? `<ul class="pj-tasks">${tasks}</ul>` : `<p class="cond">${esc(t('No late tasks and nothing due today'))}</p>`}`
}

/**
 * 開く手段：いま開いている案件は残りの画面へ。デスクトップアプリなら［開く］で切り替え、
 * ブラウザなら開くためのコマンドを出す（ブラウザから別の案件の server は起こせない）
 * @param {ProjectEntry} p
 */
function openHtml(p) {
  if (p.current) return `<a class="btn-ghost" href="#phases">${esc(t('Remaining work to release'))}</a>`
  if (!p.summary) return ''
  if (window.__TAURI__) return `<button type="button" class="btn-ghost pj-open" data-dir="${esc(p.dir)}">${esc(t('Open'))}</button>`
  return ''
}

/** ブラウザで見ているときだけ、ほかの案件を開くコマンド @param {ProjectEntry} p */
const commandHtml = p => (!p.current && p.summary && !window.__TAURI__ ? `<code class="pj-command">tadori serve "${esc(p.dir)}"</code>` : '')

/** @param {ProjectEntry} p */
function cardHtml(p) {
  // 読めなかった案件は、フォルダの最後の名前で呼ぶ（場所は下の行に出す）
  const name = p.summary?.name ?? (p.dir.split(/[\\/]/).filter(Boolean).at(-1) ?? p.dir)
  return `<section class="panel pj-card${p.current ? ' is-current' : ''}">
    <header class="pj-head">
      <h2>${esc(name)}</h2>
      ${p.current ? chip('ok', esc(t('Open now'))) : ''}
      <span class="pj-actions">${openHtml(p)}</span>
    </header>
    <p class="pj-dir"><code>${esc(p.dir)}</code></p>
    ${commandHtml(p)}
    ${p.summary ? factsHtml(p.summary) : `<p class="form-problems">${esc(p.problem ?? '')}</p>`}
  </section>`
}

/**
 * @param {HTMLElement} view
 * @param {import('./types').ProjectState} _state
 */
export async function renderProjects(view, _state) {
  const hash = location.hash
  view.innerHTML = `<h1>${esc(t('Projects'))}</h1><p class="cond">${esc(t('Loading…'))}</p>`
  /** @type {{ projects: ProjectEntry[] }} */
  let body
  try {
    body = await api('/api/projects')
  } catch (error) {
    if (location.hash !== hash) return
    view.innerHTML = `<h1>${esc(t('Projects'))}</h1><p class="form-problems">${esc(messageOf(error))}</p>`
    return
  }
  // 読み込みの間に別の画面へ移っていたら描かない
  if (location.hash !== hash) return
  const note = window.__TAURI__ ? '' : `<p class="cond">${esc(t('To open another project in the browser, run its command in a terminal. The desktop app can switch here.'))}</p>`
  view.innerHTML = `
    <h1>${esc(t('Projects'))}</h1>
    <p class="lede">${esc(t('The project open now and recent projects. Gaps, pending approvals, late tasks and tasks due today, per project.'))}</p>
    ${note}
    <div class="pj-list">${body.projects.map(cardHtml).join('')}</div>`
  view.querySelectorAll('.pj-open').forEach(button => button.addEventListener('click', () => {
    const dir = /** @type {HTMLElement} */ (button).dataset.dir ?? ''
    window.__TAURI__?.core.invoke('open_project', { path: dir }).catch(error => toast(messageOf(error)))
  }))
}
