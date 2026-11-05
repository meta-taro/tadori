// リリースまでの残課題：タイムラインとカードの切り替え。割合や点数は出さない
import { chip, day, esc, fullDate, kindLabel, lateColor, shortDate, isDoneStatus } from './util.js'

const MONTHS = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月']
let gateView = 'timeline'
let selectedPhase = null

const badgesOf = gate => [
  gate.leaks.length ? chip('hole', `漏れ ${gate.leaks.length}`) : '',
  gate.pendingApprovals.length ? chip('wait', `承認待ち ${gate.pendingApprovals.length}`) : '',
  !gate.leaks.length && !gate.pendingApprovals.length ? chip('ok', '通過') : '',
].join('')

function timelineHtml(state) {
  const gates = state.gates.filter(g => g.span)
  const lo = Math.min(...gates.map(g => day(g.span.start)))
  const hi = Math.max(...gates.map(g => day(g.span.end))) + 3 // 最後のひし形と件数が切れないよう少し余白
  const pos = iso => `${((day(iso) - lo) / (hi - lo) * 100).toFixed(2)}%`
  const months = [], weeks = []
  for (let t = lo; t <= hi; t++) {
    const d = new Date(t * 86_400_000)
    const iso = d.toISOString().slice(0, 10)
    if (iso.endsWith('-01')) months.push(iso)
    if (d.getUTCDay() === 1) weeks.push(iso)
  }
  const grid = weeks.map(w => `<span class="tl-week" style="left:${pos(w)}"></span>`).join('')
    + months.map(m => `<span class="tl-month" style="left:${pos(m)}"><b>${MONTHS.at(Number(m.slice(5, 7)) - 1)}</b></span>`).join('')

  const rows = state.gates.map((gate, i) => {
    if (!gate.span) return ''
    const open = gate.tasks.filter(t => !isDoneStatus(state, t.status))
    const barColor = open.length ? lateColor(gate.maxLateDays) : 'var(--ok)'
    const overdue = day(state.today) > day(gate.span.end) && gate.state !== 'clear'
    const steps = gate.tasks.filter(t => t.end).map(t => {
      const cls = isDoneStatus(state, t.status) ? 'done' : gate.currentTask && t.id === gate.currentTask.id ? 'now' : ''
      return `<span class="tl-step ${cls}" style="left:${pos(t.end)}" title="${esc(t.id)} ${esc(t.name)}"></span>`
    }).join('')
    const status = gate.currentTask ? (state.statuses.find(s => s.id === gate.currentTask.status)?.name ?? '') : ''
    const runner = gate.currentTask?.end ? `<span class="tl-runner" style="left:${pos(gate.currentTask.end)}">${esc(gate.currentTask.id)} ${esc(status)}</span>` : ''
    const hatchEnd = day(state.today) < day(gate.span.end) ? state.today : gate.span.end
    const hatch = gate.startedBefore && day(hatchEnd) > day(gate.span.start)
      ? `<span class="tl-hatch" style="left:${pos(gate.span.start)};width:calc(${pos(hatchEnd)} - ${pos(gate.span.start)})"></span>` : ''
    const early = gate.startedBefore ? `<span class="tl-early">${esc(gate.startedBefore.name)}の完了判定より前に着手</span>` : ''
    const late = gate.maxLateDays ? `<span class="late" style="color:${barColor}">${gate.maxLateDays} 日遅れ</span>` : ''
    return `<button type="button" class="tl-row ${gate.phase.id === selectedPhase ? 'on' : ''}" data-phase="${esc(gate.phase.id)}" aria-pressed="${gate.phase.id === selectedPhase}">
      <span class="tl-label"><span class="step">${String(i + 1).padStart(2, '0')}</span><span class="tl-name">${esc(gate.phase.name)}${early}</span>${late}</span>
      <span class="tl-track">
        <span class="tl-bar" style="left:${pos(gate.span.start)};width:calc(${pos(gate.span.end)} - ${pos(gate.span.start)});--bar:${barColor}"></span>
        ${hatch}${steps}${runner}
        <span class="tl-gate ${gate.state} ${overdue ? 'overdue' : ''}" style="left:${pos(gate.span.end)}" title="完了判定 ${fullDate(gate.span.end)}"></span>
        <span class="tl-badges" style="left:${pos(gate.span.end)}">${badgesOf(gate)}<span class="tl-date">${shortDate(gate.span.end)}</span></span>
      </span>
    </button>`
  }).join('')
  return `<div class="tl panel">
    <div class="tl-head"><span class="tl-label"></span><span class="tl-track">${grid}</span></div>
    <div class="tl-body">
      <span class="tl-today-wrap"><span class="tl-today" style="left:${pos(state.today)}"><span>今日 ${shortDate(state.today)}</span></span></span>
      ${rows}
    </div>
  </div>`
}

function rulePip(state, rule) {
  if (rule.kind === 'approval') {
    const ok = state.approvals.some(a => a.rule === rule.id && a.status === '承認')
    return `<span class="pip ${ok ? 'ok' : 'wait'}" title="${esc(rule.label)}">${esc(rule.id)}</span>`
  }
  const n = state.leaks.filter(l => l.rule === rule.id).length
  return `<span class="pip ${n ? 'hole' : 'ok'}" title="${esc(rule.label)}">${esc(rule.id)}</span>`
}

function cardsHtml(state) {
  const cards = state.gates.map((gate, i) => `
    <button type="button" class="stage ${gate.state}" data-phase="${esc(gate.phase.id)}" aria-pressed="${gate.phase.id === selectedPhase}">
      <div class="gate" aria-hidden="true"></div>
      <div class="step">${String(i + 1).padStart(2, '0')}</div>
      <div class="name">${esc(gate.phase.name)}</div>
      <div class="counts">${badgesOf(gate)}</div>
      <div class="rules">${gate.rules.map(r => rulePip(state, r)).join('')}</div>
    </button>`).join('')
  return `<div class="rail" role="group" aria-label="工程">${cards}</div>`
}

function ruleStatus(state, rule) {
  if (rule.kind === 'approval') {
    const a = state.approvals.find(x => x.rule === rule.id)
    if (a?.status === '承認') return chip('ok', `承認済 ${esc(a.who)} · ${esc(a.when)}`)
    return chip('wait', a ? `${esc(a.status)} ${esc(a.who)} · ${esc(a.when)}` : '承認待ち')
  }
  const leaks = state.leaks.filter(l => l.rule === rule.id)
  if (!leaks.length) return chip('ok', '漏れなし')
  return leaks.map(l => `<div class="hole-row">${chip('hole', '漏れ')}<span>${esc(l.message)}</span><a class="btn-trace" href="#trace" data-trace="${esc(l.itemId)}">たどる →</a></div>`).join('')
}

const KIND_NAMES = { covered: '機械', refers: '機械', filled: '機械', approval: '人' }

export function renderGates(view, state, onTrace) {
  const hasSchedule = state.gates.some(g => g.span)
  const shown = hasSchedule ? gateView : 'cards'
  selectedPhase ??= (state.gates.find(g => g.state !== 'clear') ?? state.gates.at(0))?.phase.id ?? null
  const gate = state.gates.find(g => g.phase.id === selectedPhase)
  const rows = (gate?.rules ?? []).map(r => `
    <tr>
      <td class="rule-id">${esc(r.id)}</td>
      <td><div class="pair">${esc(kindLabel(r.from) || r.label)}${r.to ? `<span class="arrow">→</span>${esc(kindLabel(r.to))}` : ''}</div><div class="cond">${esc(r.label)}</div></td>
      <td class="kind">${KIND_NAMES[r.kind] ?? ''}</td>
      <td>${ruleStatus(state, r)}</td>
    </tr>`).join('')
  view.innerHTML = `
    <h1>リリースまでの残課題</h1>
    <p class="lede">工程ごとに、ルールで見つかった漏れと、人の承認待ちを並べます。割合や点数は出しません。</p>
    <div class="seg" role="group" aria-label="表示">
      <button type="button" data-gate-view="timeline" aria-pressed="${shown === 'timeline'}" ${hasSchedule ? '' : 'disabled title="予定の期間が入っていないので使えません"'}>タイムライン</button>
      <button type="button" data-gate-view="cards" aria-pressed="${shown === 'cards'}">カード</button>
    </div>
    ${shown === 'timeline' ? timelineHtml(state) : cardsHtml(state)}
    ${gate ? `<h2>${esc(gate.phase.name)} · ルールと漏れ</h2>
    <div class="panel"><table>
      <thead><tr><th style="width:64px">ルール</th><th>何と何が</th><th style="width:64px">判定</th><th>いまの状態</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="4" class="cond">この工程にはルールがありません</td></tr>'}</tbody>
    </table></div>` : ''}`
  view.querySelectorAll('.tl-row, .stage').forEach(b => b.addEventListener('click', () => { selectedPhase = b.dataset.phase; renderGates(view, state, onTrace) }))
  view.querySelectorAll('[data-gate-view]').forEach(b => b.addEventListener('click', () => { gateView = b.dataset.gateView; renderGates(view, state, onTrace) }))
  view.querySelectorAll('[data-trace]').forEach(a => a.addEventListener('click', () => onTrace(a.dataset.trace)))
}

