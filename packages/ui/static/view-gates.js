// リリースまでの残課題：タイムラインとカードの切り替え。割合や点数は出さない
import { t } from './i18n.js'
import { chip, day, esc, fullDate, getWho, isMine, kindLabel, lateColor, shortDate, isDoneStatus, whoFilterChip, judgeBadge, personChips } from './util.js'

// つながりを辿るボタンの印（「つながりを辿る」の画面と同じ形）
const ICON_TRACE = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><circle cx="5" cy="3.5" r="1.6"/><circle cx="5" cy="12.5" r="1.6"/><path d="M5 5.1v5.8M5 8h4.5"/><circle cx="11" cy="8" r="1.6"/></svg>'

/** 承認の状態（中では承認・差し戻し・待ちで持つ）を画面の言葉にする */
/** @type {Readonly<Record<string, string>>} */
const APPROVAL_STATUS_NAMES = { 承認: 'Approved', 差し戻し: 'Sent back', 待ち: 'Pending approval' }

/** @typedef {import('./types').ProjectState} ProjectState */
/** @typedef {import('./types').Gate} Gate */
/** @typedef {import('./types').Rule} Rule */
/** @typedef {import('./types').Leak} Leak */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** タイムラインかカードか */
let gateView = 'timeline'
/** @type {string | null | undefined} 表を開いている工程の ID */
let selectedPhase = null

/** 見た目の状態。ルールが無い工程は「通過」の緑にしない（まだ判定していないだけ） */
const shownState = (/** @type {Gate} */ gate) => (gate.state === 'clear' && !gate.rules.length ? 'unjudged' : gate.state)

const badgesOf = (/** @type {Gate} */ gate) => [
  gate.leaks.length ? chip('hole', esc(t('Gaps {n}', { n: gate.leaks.length }))) : '',
  gate.pendingApprovals.length ? chip('wait', esc(t('Pending approvals {n}', { n: gate.pendingApprovals.length }))) : '',
  // ルールが無い工程は、まだ判定していないだけなので「通過」と出さない
  !gate.leaks.length && !gate.pendingApprovals.length ? (gate.rules.length ? chip('ok', esc(t('Passed'))) : chip('none', esc(t('No rules')))) : '',
].join('')

/** @param {ProjectState} state */
function timelineHtml(state) {
  const spans = state.gates.flatMap(g => (g.span ? [g.span] : []))
  const lo = Math.min(...spans.map(s => day(s.start)))
  const hi = Math.max(...spans.map(s => day(s.end))) + 3 // 最後のひし形と件数が切れないよう少し余白
  const pos = (/** @type {string} */ iso) => `${((day(iso) - lo) / (hi - lo) * 100).toFixed(2)}%`
  /** @type {string[]} */
  const months = []
  /** @type {string[]} */
  const weeks = []
  for (let t = lo; t <= hi; t++) {
    const d = new Date(t * 86_400_000)
    const iso = d.toISOString().slice(0, 10)
    if (iso.endsWith('-01')) months.push(iso)
    if (d.getUTCDay() === 1) weeks.push(iso)
  }
  const grid = weeks.map(w => `<span class="tl-week" style="left:${pos(w)}"></span>`).join('')
    + months.map(m => `<span class="tl-month" style="left:${pos(m)}"><b>${esc(t(MONTHS.at(Number(m.slice(5, 7)) - 1) ?? ''))}</b></span>`).join('')

  const rows = state.gates.map((gate, i) => {
    const span = gate.span
    if (!span) return ''
    const open = gate.tasks.filter(t => !isDoneStatus(state, t.status))
    const barColor = open.length ? lateColor(gate.maxLateDays) : 'var(--ok)'
    const current = gate.currentTask
    const overdue = day(state.today) > day(span.end) && gate.state !== 'clear'
    const steps = gate.tasks.flatMap(t => {
      if (!t.end) return []
      const cls = isDoneStatus(state, t.status) ? 'done' : current && t.id === current.id ? 'now' : ''
      return [`<span class="tl-step ${cls}" style="left:${pos(t.end)}" title="${esc(t.id)} ${esc(t.name)}"></span>`]
    }).join('')
    const status = current ? (state.statuses.find(s => s.id === current.status)?.name ?? '') : ''
    const runner = current?.end ? `<span class="tl-runner" style="left:${pos(current.end)}">${esc(current.id)} ${esc(status)}</span>` : ''
    const hatchEnd = day(state.today) < day(span.end) ? state.today : span.end
    const hatch = gate.startedBefore && day(hatchEnd) > day(span.start)
      ? `<span class="tl-hatch" style="left:${pos(span.start)};width:calc(${pos(hatchEnd)} - ${pos(span.start)})"></span>` : ''
    const early = gate.startedBefore ? `<span class="tl-early">${esc(t('Started before the {phase} phase gate', { phase: gate.startedBefore.name }))}</span>` : ''
    const late = gate.maxLateDays ? `<span class="late" style="color:${barColor}">${esc(t('{n} days late', { n: gate.maxLateDays }))}</span>` : ''
    return `<button type="button" class="tl-row ${gate.phase.id === selectedPhase ? 'on' : ''}" data-phase="${esc(gate.phase.id)}" aria-pressed="${gate.phase.id === selectedPhase}">
      <span class="tl-label"><span class="step">${String(i + 1).padStart(2, '0')}</span><span class="tl-name">${esc(gate.phase.name)}${early}</span>${late}</span>
      <span class="tl-track">
        <span class="tl-bar" style="left:${pos(span.start)};width:calc(${pos(span.end)} - ${pos(span.start)});--bar:${barColor}"></span>
        ${hatch}${steps}${runner}
        <span class="tl-gate ${shownState(gate)} ${overdue ? 'overdue' : ''}" style="left:${pos(span.end)}" title="${esc(t('Phase gate {date}', { date: fullDate(span.end) }))}"></span>
        <span class="tl-badges" style="left:${pos(span.end)}">${badgesOf(gate)}<span class="tl-date">${shortDate(span.end)}</span></span>
      </span>
    </button>`
  }).join('')
  return `<div class="tl panel">
    <div class="tl-head"><span class="tl-label"></span><span class="tl-track">${grid}</span></div>
    <div class="tl-body">
      <span class="tl-today-wrap"><span class="tl-today" style="left:${pos(state.today)}"><span>${esc(t('Today {date}', { date: shortDate(state.today) }))}</span></span></span>
      ${rows}
    </div>
  </div>`
}

/**
 * @param {ProjectState} state
 * @param {Rule} rule
 */
function rulePip(state, rule) {
  if (rule.kind === 'approval') {
    const ok = state.approvals.some(a => a.rule === rule.id && a.status === '承認')
    return `<span class="pip ${ok ? 'ok' : 'wait'}" title="${esc(rule.label)}">${esc(rule.id)}</span>`
  }
  const n = state.leaks.filter(l => l.rule === rule.id).length
  return `<span class="pip ${n ? 'hole' : 'ok'}" title="${esc(rule.label)}">${esc(rule.id)}</span>`
}

/** @param {ProjectState} state */
function cardsHtml(state) {
  const cards = state.gates.map((gate, i) => `
    <button type="button" class="stage ${shownState(gate)}" data-phase="${esc(gate.phase.id)}" aria-pressed="${gate.phase.id === selectedPhase}">
      <div class="gate" aria-hidden="true"></div>
      <div class="step">${String(i + 1).padStart(2, '0')}</div>
      <div class="name">${esc(gate.phase.name)}</div>
      <div class="counts">${badgesOf(gate)}</div>
      <div class="rules">${gate.rules.map(r => rulePip(state, r)).join('')}</div>
    </button>`).join('')
  return `<div class="rail" role="group" aria-label="${esc(t('Phases'))}">${cards}</div>`
}

/** どこをどう直せば消えるか（漏れ・承認待ちの下に出す） */
/**
 * ほかの道具のアイコン。URL があれば押せる。無ければ薄く出し、なぜ押せないかを添える
 * （どこへつながるのかを先に見て分かるようにするため）。
 * @param {string} tool
 * @param {string} mark
 * @param {string | undefined} url
 * @param {string} readyTitle
 * @param {string} waitingTitle
 */
function toolIcon(tool, mark, url, readyTitle, waitingTitle) {
  return url
    ? `<a class="tool-icon tool-${tool}" href="${esc(url)}" title="${esc(readyTitle)}" aria-label="${esc(readyTitle)}">${mark}</a>`
    : `<span class="tool-icon tool-${tool} off" title="${esc(waitingTitle)}" aria-label="${esc(waitingTitle)}" aria-disabled="true">${mark}</span>`
}

/**
 * 直し方の 1 行と、md-business（原本を開く）・git-qa（その場で実施する）のアイコン
 * @param {string | undefined} fix
 * @param {Leak} [leak]
 */
function fixHtml(fix, leak) {
  if (!fix) return ''
  const place = leak?.file ? (leak.line ? t('{file} line {line}', { file: leak.file, line: leak.line }) : leak.file) : ''
  const md = leak?.file
    ? toolIcon('md', 'md', leak.openUrl, t('Open {place} in md-business', { place }), t('Open {place} in md-business (available once md-business provides the URL format)', { place }))
    : ''
  const qa = leak?.runnable
    ? toolIcon('qa', 'qa', leak.runUrl, t('Run {id} in git-qa', { id: leak.itemId }), t('Run {id} in git-qa (available once git-qa provides the URL format)', { id: leak.itemId }))
    : ''
  // アイコンは直し方の文の下に 1 段で並べる（文が折り返しても重ならないように）
  const icons = md || qa ? `<div class="tool-icons">${md}${qa}</div>` : ''
  return `<div class="fix-line"><span class="fix-label">${esc(t('How to fix'))}</span>${esc(fix)}</div>${icons}`
}

/**
 * @param {ProjectState} state
 * @param {Rule} rule
 */
function ruleStatus(state, rule) {
  if (rule.kind === 'approval') {
    const a = state.approvals.find(x => x.rule === rule.id)
    if (a?.status === '承認') return chip('ok', esc(t('Approved {who} · {when}', { who: a.who, when: a.when })))
    const pending = state.gates.flatMap(g => g.pending ?? []).find(p => p.rule.id === rule.id)
    // 承認のあとに見る文書が commit された：承認待ちに戻し、どのファイルのどの commit かを札で出す
    const changed = pending?.changedAfter
    if (a && changed) {
      return chip('wait', esc(t('Changed after approval'))) + ` <span class="changed-after" title="${esc(t('Approved {who} · {when}', { who: a.who, when: a.when }))}"><code>${esc(changed.file)}</code> <code>${esc(changed.commit)}</code> ${esc(changed.date.slice(0, 10))}</span>` + fixHtml(pending?.fix)
    }
    return chip('wait', a ? `${esc(t(APPROVAL_STATUS_NAMES[a.status] ?? a.status))} ${esc(a.who)} · ${esc(a.when)}` : esc(t('Pending approval'))) + fixHtml(pending?.fix)
  }
  const leaks = state.leaks.filter(l => l.rule === rule.id)
  if (!leaks.length) return chip('ok', esc(t('No gaps')))
  // 1 つのルールに漏れが数百あっても読めるよう、最初は 3 件だけ。残りはその場で開く
  const limit = expandedRules.has(rule.id) ? leaks.length : LEAKS_PER_RULE
  const rows = leaks.slice(0, limit).map(l => `<div class="hole-row"><span class="leak-id" title="${esc(t('Gap name (rule·row)'))}">${esc(l.rule)}·${esc(l.itemId)}</span><span>${esc(l.message)}${fixHtml(l.fix, l)}</span><a class="btn-ghost btn-trace" href="#trace" data-trace="${esc(l.itemId)}">${ICON_TRACE}<span>${esc(t('Trace it'))}</span></a></div>`).join('')
  const more = leaks.length > limit ? `<button type="button" class="btn-ghost leaks-more" data-expand="${esc(rule.id)}">${esc(t('Show {n} more', { n: leaks.length - limit }))}</button>` : ''
  return rows + more
}

// 残課題の表を大きな案件でも読めるようにする設定（画面を移っても覚えておく）
const LEAKS_PER_RULE = 3
const RULES_PAGE = 50
/** @type {Set<string>} 漏れを全部出しているルールの ID */
const expandedRules = new Set()
let showSatisfied = false
let rulesShown = RULES_PAGE

/**
 * 残っているルール（漏れがある・承認されていない）
 * @param {ProjectState} state
 * @param {Rule} rule
 */
function isRemaining(state, rule) {
  if (rule.kind === 'approval') return !state.approvals.some(a => a.rule === rule.id && a.status === '承認')
  return state.leaks.some(l => l.rule === rule.id)
}


/**
 * @param {HTMLElement} view
 * @param {ProjectState} state
 * @param {(itemId: string) => void} onTrace
 * @param {string} [phaseId]
 */
export function renderGates(view, state, onTrace, phaseId) {
  // URL の #phases-it のように工程を指されたら、その工程の表を開く（会議で URL を渡せるように）
  if (phaseId && state.gates.some(g => g.phase.id === phaseId) && phaseId !== selectedPhase) {
    selectedPhase = phaseId
    rulesShown = RULES_PAGE
  }
  const hasSchedule = state.gates.some(g => g.span)
  const shown = hasSchedule ? gateView : 'cards'
  selectedPhase ??= (state.gates.find(g => g.state !== 'clear') ?? state.gates.at(0))?.phase.id ?? null
  const gate = state.gates.find(g => g.phase.id === selectedPhase)
  // 残課題の画面なので、最初は残っているルール（漏れ・承認待ち）だけ。50 件ずつ出す
  const allRules = gate?.rules ?? []
  const remaining = allRules.filter(r => isRemaining(state, r))
  // 担当は上の帯で選ぶ（どの画面も同じ）。ルールの担当は役割なので、人の表の役割でも見分ける
  const listed = (showSatisfied ? allRules : remaining).filter(r => isMine(state, r.owner))
  const rows = listed.slice(0, rulesShown).map(r => `
    <tr>
      <td class="rule-id">${esc(r.id)}</td>
      <td><div class="pair">${esc(kindLabel(r.from) || r.label)}${r.to ? `<span class="arrow">→</span>${esc(kindLabel(r.to))}` : ''}</div><div class="cond">${esc(r.label)}</div></td>
      <td>${judgeBadge(r.kind)}</td>
      <td>${personChips(r.owner)}</td>
      <td>${ruleStatus(state, r)}</td>
    </tr>`).join('')
  view.innerHTML = `
    <h1>${esc(t('Remaining work to release'))}</h1>
    <p class="lede">${esc(t('For each phase, lists the gaps found by the rules and the approvals waiting on people. No percentages or scores.'))}</p>
    <div class="seg" role="group" aria-label="${esc(t('View'))}">
      <button type="button" data-gate-view="timeline" aria-pressed="${shown === 'timeline'}" ${hasSchedule ? '' : `disabled title="${esc(t('Not available: no scheduled dates are set'))}"`}>${esc(t('Timeline'))}</button>
      <button type="button" data-gate-view="cards" aria-pressed="${shown === 'cards'}">${esc(t('Cards'))}</button>
    </div>
    ${shown === 'timeline' ? timelineHtml(state) : cardsHtml(state)}
    ${gate ? `<div class="gate-table-head">
      <h2>${esc(gate.phase.name)} <span class="count-badge" title="${esc(t('Remaining rules: {n} of {total}', { n: remaining.length, total: allRules.length }))}">${esc(t('{n} left of {total}', { n: remaining.length, total: allRules.length }))}</span></h2>
      <span class="gate-filters">
        ${whoFilterChip()}
        <label class="switch"><input type="checkbox" id="show-satisfied" ${showSatisfied ? 'checked' : ''}><span class="switch-track" aria-hidden="true"></span><span>${esc(t('Also show rules that are met'))}</span></label>
      </span>
    </div>
    <div class="panel"><table>
      <thead><tr><th style="width:72px">${esc(t('Rule'))}</th><th>${esc(t('Between'))}</th><th style="width:84px">${esc(t('Judged by'))}</th><th style="width:130px">${esc(t('Owner'))}</th><th>${esc(t('Status (how to fix)'))}</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="5" class="cond">${esc(allRules.length ? t('No rules remain in this phase') : t('This phase has no rules'))}</td></tr>`}</tbody>
    </table>
    ${listed.length > rulesShown ? `<button type="button" class="btn-ghost rules-more" id="gate-more">${esc(t('{n} more ({rest} left)', { n: Math.min(RULES_PAGE, listed.length - rulesShown), rest: listed.length - rulesShown }))}</button>` : ''}
    </div>` : ''}`
  const rerender = () => renderGates(view, state, onTrace)
  const satisfiedBox = /** @type {HTMLInputElement | null} */ (view.querySelector('#show-satisfied'))
  satisfiedBox?.addEventListener('change', () => { showSatisfied = satisfiedBox.checked; rulesShown = RULES_PAGE; rerender() })
  view.querySelector('#gate-more')?.addEventListener('click', () => { rulesShown += RULES_PAGE; rerender() })
  // 下の data-* は、どれも直前に描いた要素に付けたもの
  const all = (/** @type {string} */ selector) => /** @type {NodeListOf<HTMLElement>} */ (view.querySelectorAll(selector))
  all('[data-expand]').forEach(b => b.addEventListener('click', () => { expandedRules.add(b.dataset.expand ?? ''); rerender() }))
  all('.tl-row, .stage').forEach(b => b.addEventListener('click', () => { selectedPhase = b.dataset.phase; rulesShown = RULES_PAGE; renderGates(view, state, onTrace) }))
  all('[data-gate-view]').forEach(b => b.addEventListener('click', () => { gateView = b.dataset.gateView ?? 'timeline'; renderGates(view, state, onTrace) }))
  all('[data-trace]').forEach(a => a.addEventListener('click', () => onTrace(a.dataset.trace ?? '')))
}

