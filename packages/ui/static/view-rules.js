// ルールセット：1,000 行を超えても探せるように、探す欄・絞り込み・工程ごとの帯・少しずつ出す
import { api, ApiError, esc, ICON_INFO, isMine, kindLabel, messageOf, peopleOf, toastCommit, within } from './util.js'

/** @typedef {import('./types').ProjectState} ProjectState */
/** @typedef {import('./types').Rule} Rule */
/** @typedef {'leak' | 'wait' | 'ok'} RuleStatusKey */
/** @typedef {{ query: string, phase: string, judge: string, status: string, sort: string }} RuleFilters */

const PAGE = 50
/** @type {Readonly<Record<string, string>>} */
const KIND_NAMES = { covered: '下流が出ている', refers: '上流を元にしている', filled: '列が埋まっている', approval: '人の承認' }

// 画面を移っても、絞り込みと開け閉めは覚えておく
/** @type {RuleFilters} */
const filters = { query: '', phase: 'all', judge: 'all', status: 'all', sort: 'id' }
/** @type {Set<string>} */
const closedPhases = new Set()
/** @type {Map<string, number>} 工程 → いま出している件数 */
const shownCount = new Map()
// 「消す」を 1 回押したルール。ファイルの変化の知らせで画面が描き直されても、押した状態を保つ（しばらくで戻す）
let armedRuleId = ''
/** @type {ReturnType<typeof setTimeout> | undefined} */
let armedTimer
const ARMED_MS = 5000

/**
 * ルールのいまの状態：漏れ（件数）・承認待ち・満たす
 * @param {ProjectState} state @param {Rule} rule
 * @returns {{ key: RuleStatusKey, count: number }}
 */
function statusOf(state, rule) {
  if (rule.kind === 'approval') {
    const approved = state.approvals.some(a => a.rule === rule.id && a.status === '承認')
    return approved ? { key: 'ok', count: 0 } : { key: 'wait', count: 0 }
  }
  const count = state.leaks.filter(l => l.rule === rule.id).length
  return count ? { key: 'leak', count } : { key: 'ok', count: 0 }
}

/** @type {Record<RuleStatusKey, (n: number) => string>} */
const STATUS_HTML = {
  leak: n => `<span class="chip hole"><span class="dot"></span>漏れ ${n} 件</span>`,
  wait: () => '<span class="chip wait"><span class="dot"></span>承認待ち</span>',
  ok: () => '<span class="chip ok"><span class="dot"></span>満たす</span>',
}

/** @param {Rule} rule */
function whatText(rule) {
  const from = rule.from ? kindLabel(rule.from) : ''
  const to = rule.to ? kindLabel(rule.to) : ''
  return `${from}${to ? ` → ${to}` : ''}${rule.field ? ` の ${rule.field}` : ''}`
}

/** @param {Rule} rule @param {string[]} words */
function matches(rule, words) {
  const text = `${rule.id} ${rule.label} ${whatText(rule)} ${KIND_NAMES[rule.kind]} ${rule.owner ?? ''}`.toLowerCase()
  return words.every(w => text.includes(w))
}

/** @param {ProjectState} state @returns {Rule[]} */
function filtered(state) {
  const words = filters.query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const list = state.rules.filter(r =>
    matches(r, words)
    && (filters.phase === 'all' || r.phase === filters.phase)
    && (filters.judge === 'all' || (filters.judge === 'human') === (r.kind === 'approval'))
    && (filters.status === 'all' || statusOf(state, r).key === filters.status)
    // 上の帯の担当で絞る（ルールの担当は役割。人の表の役割でも見分ける）
    && isMine(state, r.owner))
  const byId = (/** @type {Rule} */ a, /** @type {Rule} */ b) => a.id.localeCompare(b.id, 'ja', { numeric: true })
  return filters.sort === 'leaks'
    ? [...list].sort((a, b) => statusOf(state, b).count - statusOf(state, a).count || byId(a, b))
    : [...list].sort(byId)
}

/** @param {ProjectState} state @param {Rule} r */
function ruleRow(state, r) {
  const s = statusOf(state, r)
  return `<tr>
    <td class="rule-id">${esc(r.id)}</td>
    <td><div class="pair">${esc(whatText(r))}</div>${r.only ? `<div class="cond">${esc(r.only.field)} が「${esc(r.only.value)}」の行だけ</div>` : ''}</td>
    <td class="cond">${esc(r.label)}</td>
    <td class="kind">${KIND_NAMES[r.kind]}</td>
    <td class="kind">${esc(r.owner ?? '')}</td>
    <td>${STATUS_HTML[s.key](s.count)}</td>
    <td class="rule-actions"><button type="button" class="btn-ghost" data-edit="${esc(r.id)}">直す</button><button type="button" class="btn-ghost" data-remove="${esc(r.id)}">${r.id === armedRuleId ? 'もう一度押すと消す' : '消す'}</button></td>
  </tr>`
}

/** @param {ProjectState} state */
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
      <table><thead><tr><th style="width:72px">ID</th><th style="width:28%">何と何が</th><th>条件</th><th style="width:130px">判定</th><th style="width:96px">担当</th><th style="width:120px">いまの状態</th><th style="width:120px"><span class="sr-only">操作</span></th></tr></thead>
      <tbody>${inPhase.slice(0, limit).map(r => ruleRow(state, r)).join('')}</tbody></table>${more}
    </details>`
  }).join('')
}

/**
 * @param {keyof RuleFilters} name
 * @param {Array<[string, string]>} options [値, 見出し]
 */
function segHtml(name, options) {
  return `<div class="seg" role="group" aria-label="${esc(name)}">${options.map(([value, label]) =>
    `<button type="button" data-filter="${esc(name)}" data-value="${esc(value)}" aria-pressed="${filters[name] === value}">${esc(label)}</button>`).join('')}</div>`
}

/**
 * 空いている次のルールの ID（R の後ろの数がいちばん大きいものの次）
 * @param {ProjectState} state
 */
function nextRuleId(state) {
  const numbers = state.rules.map(r => /^R(\d+)$/.exec(r.id)?.[1]).filter(Boolean).map(Number)
  return `R${(numbers.length ? Math.max(...numbers) : 0) + 1}`
}

/**
 * ルールを足す・直す欄。rule を渡すと、その中身で直す（ID は変えない）
 * @param {ProjectState} state @param {Rule | undefined} rule
 */
function ruleFormHtml(state, rule) {
  const r = rule ?? { id: nextRuleId(state), phase: state.phases[0]?.id ?? '', kind: 'covered', from: '', to: '', field: '', owner: '', label: '' }
  const only = rule?.only ? `${rule.only.field}=${rule.only.value}` : ''
  const kinds = Object.keys(state.labels?.kinds ?? {})
  const columns = Object.keys(state.labels?.columns ?? {})
  return `<form class="add rule-form" id="rule-form" data-mode="${rule ? 'edit' : 'add'}">
    <h2>${rule ? `ルール ${esc(rule.id)} を直す` : 'ルールを足す'}</h2>
    <label>ID<input name="id" value="${esc(r.id)}" ${rule ? 'readonly' : ''} required maxlength="64"></label>
    <label>工程<select name="phase">${state.phases.map(p => `<option value="${esc(p.id)}" ${p.id === r.phase ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
    <label>判定<select name="kind">${Object.entries(KIND_NAMES).map(([k, n]) => `<option value="${k}" ${k === r.kind ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
    <label>元の種類<input name="from" value="${esc(r.from)}" list="rule-kinds" placeholder="例：TC"></label>
    <label>先の種類<input name="to" value="${esc(r.to)}" list="rule-kinds" placeholder="例：RUN（下流・上流のとき）"></label>
    <label>列<input name="field" value="${esc(r.field)}" list="rule-columns" placeholder="列が埋まっているのとき"></label>
    <label>対象を絞る<input name="only" value="${esc(only)}" placeholder="例：change=変わる"></label>
    <label>担当<input name="owner" value="${esc(r.owner ?? '')}" list="rule-people" placeholder="直す担当（役割）"></label>
    <label class="grow">条件の文<input name="label" value="${esc(r.label)}" required maxlength="200" placeholder="人が読む一文（例：試験ケースに実施の記録がある）"></label>
    <datalist id="rule-kinds">${kinds.map(k => `<option value="${esc(k)}">${esc(kindLabel(k))}</option>`).join('')}</datalist>
    <datalist id="rule-columns">${columns.map(c => `<option value="${esc(c)}"></option>`).join('')}</datalist>
    <datalist id="rule-people">${peopleOf(state).map(p => `<option value="${esc(p)}"></option>`).join('')}</datalist>
    <div class="form-problems" role="alert"></div>
    <div class="actions"><button type="button" class="btn-ghost" data-cancel>やめる</button><button type="submit" class="btn-primary">保存</button></div>
  </form>`
}

/** 欄の中身を、API に渡す形にする（空の項目は、足すときは送らず、直すときは空にする） */
/** @param {HTMLFormElement} form @param {boolean} isEdit @returns {Record<string, string>} */
function ruleBody(form, isEdit) {
  const data = Object.fromEntries(new FormData(form).entries())
  /** @type {Record<string, string>} */
  const body = {}
  for (const key of ['phase', 'kind', 'from', 'to', 'field', 'only', 'owner', 'label']) {
    const value = String(data[key] ?? '').trim()
    if (value || isEdit) body[key] = value
  }
  return body
}

/**
 * @param {HTMLElement} view
 * @param {ProjectState} state
 * @param {() => Promise<void>} reload 保存したあとに案件を読み直す
 */
export function renderRules(view, state, reload) {
  /** @type {Array<[string, string]>} */
  const phaseOptions = [['all', 'すべての工程'], ...state.phases.map(p => /** @type {[string, string]} */ ([p.id, p.name]))]
  view.innerHTML = `
    <h1>ルールセット</h1>
    <p class="lede">工程ごとのルールセットです。エージェントは作業の前にこれを読んで守り、チェックした結果を記録に残します。人の承認が要るルールは、人がチェックします。
      ルールは <span class="mono">.tadori/rulesets/*.tsv</span> に書かれています。ここから足す・直す・消すと、保存して commit します（push は人）。</p>
    <div class="rules-add"><button type="button" class="btn-primary" id="rule-add">ルールを足す</button></div>
    <div id="rule-form-slot"></div>
    <div class="rules-tools">
      <input id="rules-query" class="glossary-query" type="search" placeholder="ルールを探す（例：R9、試験ケース、改修後、検証担当）" value="${esc(filters.query)}" aria-label="ルールを探す">
      ${segHtml('phase', phaseOptions)}
      <div class="rules-tools-row">
        ${segHtml('judge', [['all', '判定：すべて'], ['machine', '機械'], ['human', '人']])}
        ${segHtml('status', [['all', '状態：すべて'], ['leak', '漏れあり'], ['wait', '承認待ち'], ['ok', '満たす']])}
        ${segHtml('sort', [['id', 'ID 順'], ['leaks', '漏れの多い順']])}
      </div>
    </div>
    <div class="cond rules-total" id="rules-total"></div>
    <div class="panel rules-list" id="rules-list"></div>`

  const list = within(view, '#rules-list')
  const total = within(view, '#rules-total')
  const draw = () => {
    const n = filtered(state).length
    total.textContent = n === state.rules.length ? `ルール ${n} 件` : `ルール ${state.rules.length} 件のうち ${n} 件`
    list.innerHTML = listHtml(state)
    list.querySelectorAll('details[data-group]').forEach(el => {
      const d = /** @type {HTMLDetailsElement} */ (el)
      const group = d.dataset.group ?? ''
      d.addEventListener('toggle', () => { if (d.open) closedPhases.delete(group); else closedPhases.add(group) })
    })
    list.querySelectorAll('[data-more]').forEach(el => {
      const phase = /** @type {HTMLElement} */ (el).dataset.more ?? ''
      el.addEventListener('click', () => { shownCount.set(phase, (shownCount.get(phase) ?? PAGE) + PAGE); draw() })
    })
  }
  draw()
  bindRuleEditing(view, state, reload)
  // 打つたびに一覧だけ描き直す（欄ごと描き直すと、打っている途中で入力が切れる）
  const query = /** @type {HTMLInputElement} */ (within(view, '#rules-query'))
  query.addEventListener('input', () => { filters.query = query.value; shownCount.clear(); draw() })
  view.querySelectorAll('[data-filter]').forEach(el => el.addEventListener('click', () => {
    const b = /** @type {HTMLElement} */ (el)
    const name = /** @type {keyof RuleFilters} */ (b.dataset.filter)
    filters[name] = b.dataset.value ?? ''
    shownCount.clear()
    // 読み直しの口も渡す（渡さないと、絞り込みを替えたあとの保存で一覧が新しくならない）
    renderRules(view, state, reload)
  }))
}

/** 足す・直す・消す（保存したら案件を読み直す。断られたら理由を欄に出し、一覧は変えない） */
/** @param {HTMLElement} view @param {ProjectState} state @param {() => Promise<void>} reload */
function bindRuleEditing(view, state, reload) {
  const slot = within(view, '#rule-form-slot')
  const open = (/** @type {Rule | undefined} */ rule) => {
    slot.innerHTML = ruleFormHtml(state, rule)
    const form = /** @type {HTMLFormElement} */ (within(slot, '#rule-form'))
    within(form, '[data-cancel]').addEventListener('click', () => { slot.innerHTML = '' })
    form.addEventListener('submit', async e => {
      e.preventDefault()
      const isEdit = form.dataset.mode === 'edit'
      const id = String(new FormData(form).get('id') ?? '').trim()
      const body = ruleBody(form, isEdit)
      try {
        const result = isEdit
          ? await api(`/api/rules/${encodeURIComponent(id)}`, { method: 'PUT', body })
          : await api('/api/rules', { method: 'POST', body: { id, ...body } })
        toastCommit(`ルール ${id} `, result.commit)
        slot.innerHTML = ''
        await reload()
      } catch (error) {
        const problems = error instanceof ApiError && error.problems.length ? error.problems : [messageOf(error)]
        within(form, '.form-problems').innerHTML = problems.map(p => `<div>${esc(p)}</div>`).join('')
      }
    })
    within(form, rule ? '[name="label"]' : '[name="id"]').focus()
  }
  within(view, '#rule-add').addEventListener('click', () => open(undefined))
  within(view, '#rules-list').addEventListener('click', async e => {
    const found = e.target instanceof Element ? e.target.closest('button[data-edit], button[data-remove]') : null
    if (!(found instanceof HTMLButtonElement)) return
    const button = found
    const id = button.dataset.edit ?? button.dataset.remove ?? ''
    if (button.dataset.edit) { open(state.rules.find(r => r.id === id)); return }
    // 消すのは 2 回押す（押し間違いで消さないように。消しても git の履歴からは戻せる）
    if (armedRuleId !== id) {
      armedRuleId = id
      button.textContent = 'もう一度押すと消す'
      clearTimeout(armedTimer)
      // 描き直されていても、いま画面にあるボタンを戻す
      armedTimer = setTimeout(() => {
        armedRuleId = ''
        view.querySelectorAll('button[data-remove]').forEach(b => { b.textContent = '消す' })
      }, ARMED_MS)
      return
    }
    armedRuleId = ''
    clearTimeout(armedTimer)
    try {
      const result = await api(`/api/rules/${encodeURIComponent(id)}`, { method: 'DELETE' })
      toastCommit(`ルール ${id} の削除を`, result.commit)
      await reload()
    } catch (error) {
      button.textContent = '消せませんでした'
      button.title = messageOf(error)
    }
  })
}

/**
 * 検索から開くとき、その言葉で絞った状態にする
 * @param {string} value
 */
export function setRulesQuery(value) {
  filters.query = value
  filters.phase = 'all'
  filters.judge = 'all'
  filters.status = 'all'
  shownCount.clear()
}
