// リリースまでの残課題：タイムラインとカードの切り替え。割合や点数は出さない
import { chip, day, esc, fullDate, kindLabel, lateColor, shortDate, isDoneStatus } from './util.js'

const MONTHS = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月']
let gateView = 'timeline'
let selectedPhase = null

/** 見た目の状態。ルールが無い工程は「通過」の緑にしない（まだ判定していないだけ） */
const shownState = gate => (gate.state === 'clear' && !gate.rules.length ? 'unjudged' : gate.state)

const badgesOf = gate => [
  gate.leaks.length ? chip('hole', `漏れ ${gate.leaks.length}`) : '',
  gate.pendingApprovals.length ? chip('wait', `承認待ち ${gate.pendingApprovals.length}`) : '',
  // ルールが無い工程は、まだ判定していないだけなので「通過」と出さない
  !gate.leaks.length && !gate.pendingApprovals.length ? (gate.rules.length ? chip('ok', '通過') : chip('none', 'ルールなし')) : '',
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
        <span class="tl-gate ${shownState(gate)} ${overdue ? 'overdue' : ''}" style="left:${pos(gate.span.end)}" title="完了判定 ${fullDate(gate.span.end)}"></span>
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
    <button type="button" class="stage ${shownState(gate)}" data-phase="${esc(gate.phase.id)}" aria-pressed="${gate.phase.id === selectedPhase}">
      <div class="gate" aria-hidden="true"></div>
      <div class="step">${String(i + 1).padStart(2, '0')}</div>
      <div class="name">${esc(gate.phase.name)}</div>
      <div class="counts">${badgesOf(gate)}</div>
      <div class="rules">${gate.rules.map(r => rulePip(state, r)).join('')}</div>
    </button>`).join('')
  return `<div class="rail" role="group" aria-label="工程">${cards}</div>`
}

/** どこをどう直せば消えるか（漏れ・承認待ちの下に出す） */
/**
 * ほかの道具のアイコン。URL があれば押せる。無ければ薄く出し、なぜ押せないかを添える
 * （どこへつながるのかを先に見て分かるようにするため）。
 */
function toolIcon(tool, mark, url, readyTitle, waitingTitle) {
  return url
    ? `<a class="tool-icon tool-${tool}" href="${esc(url)}" title="${esc(readyTitle)}" aria-label="${esc(readyTitle)}">${mark}</a>`
    : `<span class="tool-icon tool-${tool} off" title="${esc(waitingTitle)}" aria-label="${esc(waitingTitle)}" aria-disabled="true">${mark}</span>`
}

/** 直し方の 1 行と、md-business（原本を開く）・git-qa（その場で実施する）のアイコン */
function fixHtml(fix, leak) {
  if (!fix) return ''
  const place = leak?.file ? `${leak.file}${leak.line ? ` の ${leak.line} 行目` : ''}` : ''
  const md = leak?.file
    ? toolIcon('md', 'md', leak.openUrl, `md-business で ${place} を開く`, `md-business で ${place} を開く（md-business から URL の形が届いたら押せます）`)
    : ''
  const qa = leak?.runnable
    ? toolIcon('qa', 'qa', leak.runUrl, `git-qa で ${leak.itemId} を実施する`, `git-qa で ${leak.itemId} を実施する（git-qa から URL の形が届いたら押せます）`)
    : ''
  // アイコンは直し方の文の下に 1 段で並べる（文が折り返しても重ならないように）
  const icons = md || qa ? `<div class="tool-icons">${md}${qa}</div>` : ''
  return `<div class="fix-line"><span class="fix-label">直し方</span>${esc(fix)}</div>${icons}`
}

function ruleStatus(state, rule) {
  if (rule.kind === 'approval') {
    const a = state.approvals.find(x => x.rule === rule.id)
    if (a?.status === '承認') return chip('ok', `承認済 ${esc(a.who)} · ${esc(a.when)}`)
    const pending = state.gates.flatMap(g => g.pending ?? []).find(p => p.rule.id === rule.id)
    return chip('wait', a ? `${esc(a.status)} ${esc(a.who)} · ${esc(a.when)}` : '承認待ち') + fixHtml(pending?.fix)
  }
  const leaks = state.leaks.filter(l => l.rule === rule.id)
  if (!leaks.length) return chip('ok', '漏れなし')
  // 1 つのルールに漏れが数百あっても読めるよう、最初は 3 件だけ。残りはその場で開く
  const limit = expandedRules.has(rule.id) ? leaks.length : LEAKS_PER_RULE
  const rows = leaks.slice(0, limit).map(l => `<div class="hole-row"><span class="leak-id" title="漏れの呼び名（ルール·行）">${esc(l.rule)}·${esc(l.itemId)}</span><span>${esc(l.message)}${fixHtml(l.fix, l)}</span><a class="btn-trace" href="#trace" data-trace="${esc(l.itemId)}">たどる →</a></div>`).join('')
  const more = leaks.length > limit ? `<button type="button" class="btn-ghost leaks-more" data-expand="${esc(rule.id)}">ほか ${leaks.length - limit} 件を出す</button>` : ''
  return rows + more
}

// 残課題の表を大きな案件でも読めるようにする設定（画面を移っても覚えておく）
const LEAKS_PER_RULE = 3
const RULES_PAGE = 50
const expandedRules = new Set()
let showSatisfied = false
let rulesShown = RULES_PAGE
let ownerFilter = 'all' // 担当で絞る（自分の担当だけを見る）

/** 残っているルール（漏れがある・承認されていない） */
function isRemaining(state, rule) {
  if (rule.kind === 'approval') return !state.approvals.some(a => a.rule === rule.id && a.status === '承認')
  return state.leaks.some(l => l.rule === rule.id)
}

const KIND_NAMES = { covered: '機械', refers: '機械', filled: '機械', approval: '人' }

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
  const owners = [...new Set(state.rules.map(r => r.owner).filter(Boolean))]
  const byOwner = r => ownerFilter === 'all' || r.owner === ownerFilter
  const listed = (showSatisfied ? allRules : remaining).filter(byOwner)
  const rows = listed.slice(0, rulesShown).map(r => `
    <tr>
      <td class="rule-id">${esc(r.id)}</td>
      <td><div class="pair">${esc(kindLabel(r.from) || r.label)}${r.to ? `<span class="arrow">→</span>${esc(kindLabel(r.to))}` : ''}</div><div class="cond">${esc(r.label)}</div></td>
      <td class="kind">${KIND_NAMES[r.kind] ?? ''}</td>
      <td class="kind">${esc(r.owner ?? '')}</td>
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
    ${gate ? `<div class="gate-table-head">
      <h2>${esc(gate.phase.name)} · 残っているルール ${remaining.length} 件 / 全 ${allRules.length} 件</h2>
      <span class="gate-filters">
        ${owners.length ? `<label class="cond">担当 <select id="owner-filter" class="inline-select"><option value="all">すべての担当</option>${owners.map(o => `<option ${o === ownerFilter ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></label>` : ''}
        <label class="cond"><input type="checkbox" id="show-satisfied" ${showSatisfied ? 'checked' : ''}> 満たすルールも出す</label>
      </span>
    </div>
    <div class="panel"><table>
      <thead><tr><th style="width:72px">ルール</th><th>何と何が</th><th style="width:64px">判定</th><th style="width:96px">担当</th><th>いまの状態（直し方）</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="5" class="cond">${allRules.length ? 'この工程に残っているルールはありません' : 'この工程にはルールがありません'}</td></tr>`}</tbody>
    </table>
    ${listed.length > rulesShown ? `<button type="button" class="btn-ghost rules-more" id="gate-more">さらに ${Math.min(RULES_PAGE, listed.length - rulesShown)} 件（残り ${listed.length - rulesShown} 件）</button>` : ''}
    </div>` : ''}`
  const rerender = () => renderGates(view, state, onTrace)
  view.querySelector('#show-satisfied')?.addEventListener('change', e => { showSatisfied = e.target.checked; rulesShown = RULES_PAGE; rerender() })
  view.querySelector('#owner-filter')?.addEventListener('change', e => { ownerFilter = e.target.value; rulesShown = RULES_PAGE; rerender() })
  view.querySelector('#gate-more')?.addEventListener('click', () => { rulesShown += RULES_PAGE; rerender() })
  view.querySelectorAll('[data-expand]').forEach(b => b.addEventListener('click', () => { expandedRules.add(b.dataset.expand); rerender() }))
  view.querySelectorAll('.tl-row, .stage').forEach(b => b.addEventListener('click', () => { selectedPhase = b.dataset.phase; rulesShown = RULES_PAGE; renderGates(view, state, onTrace) }))
  view.querySelectorAll('[data-gate-view]').forEach(b => b.addEventListener('click', () => { gateView = b.dataset.gateView; renderGates(view, state, onTrace) }))
  view.querySelectorAll('[data-trace]').forEach(a => a.addEventListener('click', () => onTrace(a.dataset.trace)))
}

