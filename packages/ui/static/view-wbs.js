// プロダクト → プロジェクト → WBS（Finder の列表示）。MVP では開いている案件 1 つを出す
import { api, chip, day, esc, fullDate, ICON_INFO, isDoneStatus, isMine, lateColor, lateDays, messageOf, shortDate, toast, toastCommit, within } from './util.js'

/** @typedef {import('./types').ProjectState} ProjectState */
/** @typedef {import('./types').Task} Task */

let wbsFilter = 'all'
let wbsSort = 'wbs'
/** @type {Set<string>} */
const closed = new Set() // 閉じている工程（描き直しても開閉を保つ）

/** @type {Record<string, { label: string, cmp: (state: ProjectState) => (a: Task, b: Task) => number }>} */
const SORTS = {
  wbs: { label: 'WBS 番号順', cmp: () => (a, b) => a.id.localeCompare(b.id) },
  start: { label: '開始日順', cmp: () => (a, b) => (a.start ? day(a.start) : Infinity) - (b.start ? day(b.start) : Infinity) },
  end: { label: '終了日順', cmp: () => (a, b) => (a.end ? day(a.end) : Infinity) - (b.end ? day(b.end) : Infinity) },
  status: { label: 'ステータス順', cmp: state => (a, b) => state.statuses.findIndex(s => s.id === a.status) - state.statuses.findIndex(s => s.id === b.status) },
}

/**
 * 期間の入ったタスクの、最初の開始日と最後の終了日（読み込みで start と end はかならずそろって入る）
 * @param {readonly Task[]} dated 期間の入ったタスク（1 件以上）
 */
const spanOf = dated => ({
  start: /** @type {string} */ (dated.map(t => t.start).sort().at(0)),
  end: /** @type {string} */ (dated.map(t => t.end).sort().at(-1)),
})

/**
 * @param {ProjectState} state
 * @param {Task} task
 */
function taskRow(state, task) {
  const current = state.statuses.find(s => s.id === task.status)
  const options = state.statuses.map(s => `<option value="${esc(s.id)}" ${s.id === task.status ? 'selected' : ''}>${esc(s.name)}</option>`).join('')
  const late = lateDays(state, task)
  // 終わったタスクは色を付けない。終わっていないタスクは青、遅れるほど赤へ
  const color = isDoneStatus(state, task.status) ? 'transparent' : lateColor(late)
  const lateText = late ? `<span class="late" style="color:${color}">${late} 日遅れ</span>` : ''
  // 読み込みで start と end はかならずそろって入る
  const dates = task.start ? `${shortDate(task.start)}–${shortDate(/** @type {string} */ (task.end))}` : '期間なし'
  return `<div class="wbs-task" id="task-${esc(task.id)}" style="--row-color:${color}">
    <span class="tid">${esc(task.id)}</span>
    <span>${esc(task.name)}${lateText}</span>
    <select class="status-select tone-${current?.tone ?? 'none'}" data-task="${esc(task.id)}" aria-label="${esc(task.id)} のステータス">${options}</select>
    <span class="dates">${dates}</span>
  </div>`
}

/** @param {ProjectState} state */
function wbsHtml(state) {
  const statusOptions = state.statuses.map(s => `<option value="${esc(s.id)}" ${s.id === wbsFilter ? 'selected' : ''}>${esc(s.name)}</option>`).join('')
  const sortOptions = Object.entries(SORTS).map(([k, v]) => `<option value="${k}" ${k === wbsSort ? 'selected' : ''}>${v.label}</option>`).join('')
  const groups = state.phases.map(phase => {
    // 上の帯の担当で絞る（WBS の担当は人の名前）
    const tasks = state.tasks.filter(t => t.phase === phase.id && isMine(state, t.owner))
    if (!tasks.length) return ''
    const visible = tasks.filter(t => wbsFilter === 'all' || t.status === wbsFilter).sort(SORTS[wbsSort].cmp(state))
    const open = tasks.filter(t => !isDoneStatus(state, t.status))
    const worst = open.length ? Math.max(...open.map(t => lateDays(state, t))) : 0
    const dot = open.length ? lateColor(worst) : 'var(--ok)'
    const dated = tasks.filter(t => t.start)
    const range = dated.length ? `${shortDate(spanOf(dated).start)} – ${shortDate(spanOf(dated).end)}` : ''
    return `<details class="wbs-phase" data-phase-group="${esc(phase.id)}" ${closed.has(phase.id) ? '' : 'open'}>
      <summary><span class="tw">›</span><span class="late-dot" style="background:${dot}"></span>${esc(phase.name)}<span class="count">${visible.length}/${tasks.length}</span><span class="dates">${range}</span></summary>
      ${visible.length ? visible.map(t => taskRow(state, t)).join('') : '<div class="wbs-task muted"><span></span><span>該当するタスクはありません</span></div>'}
    </details>`
  }).join('')
  return `<div class="toolbar">
      <label>ステータス<select id="wbs-filter"><option value="all">すべて</option>${statusOptions}</select></label>
      <label>並べ替え<select id="wbs-sort">${sortOptions}</select></label>
      <span class="spacer"></span>
      <button type="button" class="btn-ghost" id="wbs-open-all">すべて開く</button>
      <button type="button" class="btn-ghost" id="wbs-close-all">すべて閉じる</button>
    </div>${groups || `<div class="note">${ICON_INFO}<span>WBS（ledger/wbs.tsv）にタスクがありません。</span></div>`}`
}

/**
 * @param {HTMLElement} view
 * @param {ProjectState} state
 * @param {() => Promise<void>} reload
 * @param {string} [highlightId]
 */
export function renderWbs(view, state, reload, highlightId) {
  // 指された行（ID で開く・URL の #browse-W-03）が閉じた工程にあれば開いておく
  const target = state.tasks.find(t => t.id === highlightId)
  if (target) closed.delete(target.phase)
  const dated = state.tasks.filter(t => t.start)
  const period = dated.length ? `予定 ${fullDate(spanOf(dated).start)} – ${fullDate(spanOf(dated).end)}` : '予定期間なし'
  view.innerHTML = `
    <h1>プロダクト</h1>
    <p class="lede">プロジェクトを選ぶと WBS の骨組みが開きます。MVP では、立ち上げたときに指定した案件を 1 つ出します。</p>
    <div class="browser">
      <div class="col" role="listbox" aria-label="プロジェクト"><div class="col-head">プロジェクト<span>1</span></div>
        <button class="item" aria-selected="true"><span class="body"><span class="title">${esc(state.project.name)}</span><span class="meta">${period}</span></span><span class="chev">›</span></button>
      </div>
      <div class="col wide"><div class="col-head">WBS · おおまかな骨組み</div>
        <div class="wbs"><div class="wbs-head"><div><h3>${esc(state.project.name)}</h3><div class="meta">${period}</div></div>
          <a class="btn-primary" href="#phases" style="text-decoration:none;white-space:nowrap">残課題を開く →</a></div>
          ${wbsHtml(state)}
        </div>
      </div>
    </div>`
  const rerender = () => renderWbs(view, state, reload)
  if (target) {
    const row = view.querySelector(`#task-${CSS.escape(target.id)}`)
    row?.scrollIntoView({ block: 'center' })
    row?.classList.add('flash-row')
  }
  const filterSelect = /** @type {HTMLSelectElement} */ (within(view, '#wbs-filter'))
  filterSelect.addEventListener('change', () => { wbsFilter = filterSelect.value; rerender() })
  const sortSelect = /** @type {HTMLSelectElement} */ (within(view, '#wbs-sort'))
  sortSelect.addEventListener('change', () => { wbsSort = sortSelect.value; rerender() })
  within(view, '#wbs-open-all').addEventListener('click', () => { closed.clear(); rerender() })
  within(view, '#wbs-close-all').addEventListener('click', () => { state.phases.forEach(p => closed.add(p.id)); rerender() })
  const phaseGroups = /** @type {NodeListOf<HTMLDetailsElement>} */ (view.querySelectorAll('[data-phase-group]'))
  phaseGroups.forEach(d => d.addEventListener('toggle', () => {
    const phaseId = d.dataset.phaseGroup ?? ''
    if (d.open) closed.delete(phaseId); else closed.add(phaseId)
  }))
  const statusSelects = /** @type {NodeListOf<HTMLSelectElement>} */ (view.querySelectorAll('.status-select'))
  statusSelects.forEach(s => s.addEventListener('change', async () => {
    const taskId = s.dataset.task ?? ''
    try {
      const { commit } = await api(`/api/tasks/${encodeURIComponent(taskId)}/status`, { method: 'PUT', body: { status: s.value } })
      toastCommit(`${taskId} のステータス`, commit)
      await reload()
    } catch (error) {
      toast(messageOf(error))
    }
  }))
}
