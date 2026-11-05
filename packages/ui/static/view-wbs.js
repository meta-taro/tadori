// プロダクト → プロジェクト → WBS（Finder の列表示）。MVP では開いている案件 1 つを出す
import { api, chip, day, esc, fullDate, ICON_INFO, isDoneStatus, lateColor, lateDays, shortDate, toast, toastCommit } from './util.js'

let wbsFilter = 'all'
let wbsSort = 'wbs'
const closed = new Set() // 閉じている工程（描き直しても開閉を保つ）

const SORTS = {
  wbs: { label: 'WBS 番号順', cmp: () => (a, b) => a.id.localeCompare(b.id) },
  start: { label: '開始日順', cmp: () => (a, b) => (a.start ? day(a.start) : Infinity) - (b.start ? day(b.start) : Infinity) },
  end: { label: '終了日順', cmp: () => (a, b) => (a.end ? day(a.end) : Infinity) - (b.end ? day(b.end) : Infinity) },
  status: { label: 'ステータス順', cmp: state => (a, b) => state.statuses.findIndex(s => s.id === a.status) - state.statuses.findIndex(s => s.id === b.status) },
}

function taskRow(state, task) {
  const current = state.statuses.find(s => s.id === task.status)
  const options = state.statuses.map(s => `<option value="${esc(s.id)}" ${s.id === task.status ? 'selected' : ''}>${esc(s.name)}</option>`).join('')
  const late = lateDays(state, task)
  // 終わったタスクは色を付けない。終わっていないタスクは青、遅れるほど赤へ
  const color = isDoneStatus(state, task.status) ? 'transparent' : lateColor(late)
  const lateText = late ? `<span class="late" style="color:${color}">${late} 日遅れ</span>` : ''
  const dates = task.start ? `${shortDate(task.start)}–${shortDate(task.end)}` : '期間なし'
  return `<div class="wbs-task" style="--row-color:${color}">
    <span class="tid">${esc(task.id)}</span>
    <span>${esc(task.name)}${lateText}</span>
    <select class="status-select tone-${current?.tone ?? 'none'}" data-task="${esc(task.id)}" aria-label="${esc(task.id)} のステータス">${options}</select>
    <span class="dates">${dates}</span>
  </div>`
}

function wbsHtml(state) {
  const statusOptions = state.statuses.map(s => `<option value="${esc(s.id)}" ${s.id === wbsFilter ? 'selected' : ''}>${esc(s.name)}</option>`).join('')
  const sortOptions = Object.entries(SORTS).map(([k, v]) => `<option value="${k}" ${k === wbsSort ? 'selected' : ''}>${v.label}</option>`).join('')
  const groups = state.phases.map(phase => {
    const tasks = state.tasks.filter(t => t.phase === phase.id)
    if (!tasks.length) return ''
    const visible = tasks.filter(t => wbsFilter === 'all' || t.status === wbsFilter).sort(SORTS[wbsSort].cmp(state))
    const open = tasks.filter(t => !isDoneStatus(state, t.status))
    const worst = open.length ? Math.max(...open.map(t => lateDays(state, t))) : 0
    const dot = open.length ? lateColor(worst) : 'var(--ok)'
    const dated = tasks.filter(t => t.start)
    const range = dated.length ? `${shortDate(dated.map(t => t.start).sort().at(0))} – ${shortDate(dated.map(t => t.end).sort().at(-1))}` : ''
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

export function renderWbs(view, state, reload) {
  const dated = state.tasks.filter(t => t.start)
  const period = dated.length ? `予定 ${fullDate(dated.map(t => t.start).sort().at(0))} – ${fullDate(dated.map(t => t.end).sort().at(-1))}` : '予定期間なし'
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
  view.querySelector('#wbs-filter').addEventListener('change', e => { wbsFilter = e.target.value; rerender() })
  view.querySelector('#wbs-sort').addEventListener('change', e => { wbsSort = e.target.value; rerender() })
  view.querySelector('#wbs-open-all').addEventListener('click', () => { closed.clear(); rerender() })
  view.querySelector('#wbs-close-all').addEventListener('click', () => { state.phases.forEach(p => closed.add(p.id)); rerender() })
  view.querySelectorAll('[data-phase-group]').forEach(d => d.addEventListener('toggle', () => {
    if (d.open) closed.delete(d.dataset.phaseGroup); else closed.add(d.dataset.phaseGroup)
  }))
  view.querySelectorAll('.status-select').forEach(s => s.addEventListener('change', async e => {
    try {
      const { commit } = await api(`/api/tasks/${encodeURIComponent(e.target.dataset.task)}/status`, { method: 'PUT', body: { status: e.target.value } })
      toastCommit(`${e.target.dataset.task} のステータス`, commit)
      await reload()
    } catch (error) {
      toast(error.message)
    }
  }))
}
