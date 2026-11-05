// ルールセット：1,000 行を超えても探せるように、探す欄・絞り込み・工程ごとの帯・少しずつ出す
import { esc, ICON_INFO, kindLabel } from './util.js'

const PAGE = 50
const KIND_NAMES = { covered: '下流が出ている', refers: '上流を元にしている', filled: '列が埋まっている', approval: '人の承認' }

// 画面を移っても、絞り込みと開け閉めは覚えておく
const filters = { query: '', phase: 'all', judge: 'all', status: 'all', sort: 'id' }
const closedPhases = new Set()
const shownCount = new Map() // 工程 → いま出している件数

/** ルールのいまの状態：漏れ（件数）・承認待ち・満たす */
function statusOf(state, rule) {
  if (rule.kind === 'approval') {
    const approved = state.approvals.some(a => a.rule === rule.id && a.status === '承認')
    return approved ? { key: 'ok', count: 0 } : { key: 'wait', count: 0 }
  }
  const count = state.leaks.filter(l => l.rule === rule.id).length
  return count ? { key: 'leak', count } : { key: 'ok', count: 0 }
}

const STATUS_HTML = {
  leak: n => `<span class="chip hole"><span class="dot"></span>漏れ ${n} 件</span>`,
  wait: () => '<span class="chip wait"><span class="dot"></span>承認待ち</span>',
  ok: () => '<span class="chip ok"><span class="dot"></span>満たす</span>',
}

function whatText(rule) {
  const from = rule.from ? kindLabel(rule.from) : ''
  const to = rule.to ? kindLabel(rule.to) : ''
  return `${from}${to ? ` → ${to}` : ''}${rule.field ? ` の ${rule.field}` : ''}`
}

function matches(rule, words) {
  const text = `${rule.id} ${rule.label} ${whatText(rule)} ${KIND_NAMES[rule.kind]}`.toLowerCase()
  return words.every(w => text.includes(w))
}

function filtered(state) {
  const words = filters.query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const list = state.rules.filter(r =>
    matches(r, words)
    && (filters.phase === 'all' || r.phase === filters.phase)
    && (filters.judge === 'all' || (filters.judge === 'human') === (r.kind === 'approval'))
    && (filters.status === 'all' || statusOf(state, r).key === filters.status))
  const byId = (a, b) => a.id.localeCompare(b.id, 'ja', { numeric: true })
  return filters.sort === 'leaks'
    ? [...list].sort((a, b) => statusOf(state, b).count - statusOf(state, a).count || byId(a, b))
    : [...list].sort(byId)
}

function ruleRow(state, r) {
  const s = statusOf(state, r)
  return `<tr>
    <td class="rule-id">${esc(r.id)}</td>
    <td><div class="pair">${esc(whatText(r))}</div>${r.only ? `<div class="cond">${esc(r.only.field)} が「${esc(r.only.value)}」の行だけ</div>` : ''}</td>
    <td class="cond">${esc(r.label)}</td>
    <td class="kind">${KIND_NAMES[r.kind]}</td>
    <td>${STATUS_HTML[s.key](s.count)}</td>
  </tr>`
}

function listHtml(state) {
  const rules = filtered(state)
  if (!rules.length) return `<div class="note">${ICON_INFO}<span>合うルールがありません</span></div>`
  return state.phases.map(phase => {
    const inPhase = rules.filter(r => r.phase === phase.id)
    if (!inPhase.length) return ''
    const leaks = inPhase.reduce((n, r) => n + statusOf(state, r).count, 0)
    const limit = shownCount.get(phase.id) ?? PAGE
    const more = inPhase.length > limit
      ? `<button type="button" class="btn-ghost rules-more" data-more="${esc(phase.id)}">さらに ${Math.min(PAGE, inPhase.length - limit)} 件（残り ${inPhase.length - limit} 件）</button>` : ''
    return `<details class="rules-group" data-group="${esc(phase.id)}" ${closedPhases.has(phase.id) ? '' : 'open'}>
      <summary class="rules-band"><span class="tw">›</span><span>${esc(phase.name)}</span>
        <span class="rules-band-counts">${leaks ? `<span class="nav-badge hole" title="漏れ ${leaks} 件">${leaks}</span>` : ''}<span class="pick-count">${inPhase.length} 件</span></span></summary>
      <table><thead><tr><th style="width:72px">ID</th><th style="width:28%">何と何が</th><th>条件</th><th style="width:130px">判定</th><th style="width:120px">いまの状態</th></tr></thead>
      <tbody>${inPhase.slice(0, limit).map(r => ruleRow(state, r)).join('')}</tbody></table>${more}
    </details>`
  }).join('')
}

function segHtml(name, options) {
  return `<div class="seg" role="group" aria-label="${esc(name)}">${options.map(([value, label]) =>
    `<button type="button" data-filter="${esc(name)}" data-value="${esc(value)}" aria-pressed="${filters[name] === value}">${esc(label)}</button>`).join('')}</div>`
}

export function renderRules(view, state) {
  const phaseOptions = [['all', 'すべての工程'], ...state.phases.map(p => [p.id, p.name])]
  view.innerHTML = `
    <h1>ルールセット</h1>
    <p class="lede">工程ごとのルールセットです。エージェントは作業の前にこれを読んで守り、チェックした結果を記録に残します。人の承認が要るルールは、人がチェックします。
      ルールは <span class="mono">.tadori/rulesets/*.tsv</span> を編集して足します（画面からの追加は次の段）。</p>
    <div class="rules-tools">
      <input id="rules-query" class="glossary-query" type="search" placeholder="ルールを探す（例：R9、試験ケース、改修後）" value="${esc(filters.query)}" aria-label="ルールを探す">
      ${segHtml('phase', phaseOptions)}
      <div class="rules-tools-row">
        ${segHtml('judge', [['all', '判定：すべて'], ['machine', '機械'], ['human', '人']])}
        ${segHtml('status', [['all', '状態：すべて'], ['leak', '漏れあり'], ['wait', '承認待ち'], ['ok', '満たす']])}
        ${segHtml('sort', [['id', 'ID 順'], ['leaks', '漏れの多い順']])}
      </div>
    </div>
    <div class="cond rules-total" id="rules-total"></div>
    <div class="panel rules-list" id="rules-list"></div>`

  const list = view.querySelector('#rules-list')
  const total = view.querySelector('#rules-total')
  const draw = () => {
    const n = filtered(state).length
    total.textContent = n === state.rules.length ? `ルール ${n} 件` : `ルール ${state.rules.length} 件のうち ${n} 件`
    list.innerHTML = listHtml(state)
    list.querySelectorAll('[data-group]').forEach(d => d.addEventListener('toggle', () => {
      if (d.open) closedPhases.delete(d.dataset.group); else closedPhases.add(d.dataset.group)
    }))
    list.querySelectorAll('[data-more]').forEach(b => b.addEventListener('click', () => {
      shownCount.set(b.dataset.more, (shownCount.get(b.dataset.more) ?? PAGE) + PAGE)
      draw()
    }))
  }
  draw()
  // 打つたびに一覧だけ描き直す（欄ごと描き直すと、打っている途中で入力が切れる）
  view.querySelector('#rules-query').addEventListener('input', e => { filters.query = e.target.value; shownCount.clear(); draw() })
  view.querySelectorAll('[data-filter]').forEach(b => b.addEventListener('click', () => {
    filters[b.dataset.filter] = b.dataset.value
    shownCount.clear()
    renderRules(view, state)
  }))
}

/** 検索から開くとき、その言葉で絞った状態にする */
export function setRulesQuery(value) {
  filters.query = value
  filters.phase = 'all'
  filters.judge = 'all'
  filters.status = 'all'
  shownCount.clear()
}
