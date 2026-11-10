// tadori の画面の入口：/api/state を読み、#名前 で画面を切り替える
import { t, translateDocument } from './i18n.js'
import { api, ApiError, byId, chip, esc, getWho, ICON_INFO, messageOf, peopleOf, setKindLabels, setWho, toast } from './util.js'
import { renderGates } from './view-gates.js'
import { renderWbs } from './view-wbs.js'
import { renderLog, renderTrace } from './view-records.js'
import { renderRules, setRulesQuery } from './view-rules.js'
import { initSearch } from './search.js'
import { initDesktop } from './desktop.js'
import { initAgent } from './agent.js'
import { renderSettings } from './view-settings.js'
import { renderGlossary, setGlossaryQuery } from './view-glossary.js'
import { renderDaily } from './view-daily.js'
import { checkUpdateQuietly, warnIfServerStale } from './update.js'

// 骨組み（index.html）の言葉を、いまの言語にする
translateDocument()

const view = byId('view')
/**
 * 案件のいまの姿（/api/state）。読み込むまでは画面を描かないので、描く関数の中では必ずある
 * @type {import('./types').ProjectState}
 */
let state = /** @type {any} */ (null)

/**
 * 画面の名前 → 見出しと描き方。id は #trace-F-02 のように画面の名前のあとに付けた ID
 * @type {Record<string, { label: string, render: (id?: string) => void | Promise<void> }>}
 */
const VIEWS = {
  browse: { label: 'Product', render: id => renderWbs(view, state, reload, id) },
  phases: { label: 'Remaining work to release', render: phaseId => renderGates(view, state, id => { location.hash = `trace-${encodeURIComponent(id)}` }, phaseId) },
  daily: { label: 'Daily progress', render: () => renderDaily(view, state) },
  rules: { label: 'Rulesets', render: () => renderRules(view, state, reload) },
  log: { label: 'Check log', render: () => renderLog(view, state) },
  trace: { label: 'Trace', render: id => renderTrace(view, state, id ?? defaultTraceStart()) },
  settings: { label: 'Settings', render: () => renderSettings(view, state, reload) },
  glossary: { label: 'Glossary', render: () => renderGlossary(view) },
}

/** つながりを辿るの最初の行：漏れのある指摘、無ければ漏れのある行、無ければ指摘（何も無ければ選んでもらう） */
function defaultTraceStart() {
  const leakIds = new Set(state.leaks.map(l => l.itemId))
  const pick = state.items.find(i => i.kind === 'F' && leakIds.has(i.id))
    ?? state.items.find(i => leakIds.has(i.id))
    ?? state.items.find(i => i.kind === 'F')
  return pick?.id ?? ''
}

/** @param {string} key */
function renderChrome(key) {
  const waits = state.gates.reduce((n, g) => n + g.pendingApprovals.length, 0)
  // 最後にチェックを記録したのは、いつ・誰か（チェックの記録の最後の行。無ければ出さない）
  const last = state.checks.at(-1)
  const lastCheck = last ? `<a class="chip last-check" href="#log" title="${esc(t('Open the check log'))}">${esc(t('Last check'))} ${esc(String(last.when).slice(5, 16).replace('-', '/'))}${last.who ? ` ${esc(last.who)}` : ''}</a>` : ''
  byId('summary').innerHTML = chip('hole', esc(t('Gaps: {n}', { n: state.leaks.length }))) + chip('wait', esc(t('Pending approvals: {n}', { n: waits }))) + lastCheck
  byId('side-project').textContent = state.project.name
  byId('crumb-project').textContent = state.project.name
  byId('crumb-view').textContent = t(VIEWS[key].label)
  document.title = `tadori · ${t(VIEWS[key].label)}`
  document.querySelectorAll('nav a').forEach(el => {
    const a = /** @type {HTMLAnchorElement} */ (el)
    if (a.dataset.view === key) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current')
  })
  renderWhoFilter()
  renderNavBadges(waits)
}

/** 上の帯の「担当」：人の表と WBS の担当から選ぶ。選ぶと、どの画面もその人の分だけになる */
function renderWhoFilter() {
  const select = /** @type {HTMLSelectElement} */ (byId('who-filter'))
  const people = peopleOf(state)
  const who = getWho()
  select.innerHTML = `<option value="">${esc(t('Everyone'))}</option>${people.map(p => `<option ${p === who ? 'selected' : ''}>${esc(p)}</option>`).join('')}`
  // 選んでいた人が案件にいなくなったら（案件を切り替えたときなど）、全員に戻す
  if (who && !people.includes(who)) setWho('')
}
byId('who-filter').addEventListener('change', e => { setWho(/** @type {HTMLSelectElement} */ (e.target).value); route() })
// 絞り込みの札の × で、全員に戻す（どの画面の札も同じ）
document.addEventListener('click', e => {
  if (!(e.target instanceof Element) || !e.target.closest('[data-clear-who]')) return
  setWho('')
  ;/** @type {HTMLSelectElement} */ (byId('who-filter')).value = ''
  route()
})
// エージェントが専用カーソルで人を切り替えたとき（agent.js の filter）
window.addEventListener('tadori-who', () => route())

/**
 * 左メニューに件数のバッジを出す。0 のときは出さない（全部直せば消える）。
 * 件数は事実として出すだけで、割合や点数にはしない。
 */
/** @param {number} waits */
function renderNavBadges(waits) {
  const leakRows = new Set(state.leaks.map(l => l.itemId)).size
  /** @type {Record<string, Array<[number, string, string]>>} 画面の名前 → [件数, 色, 読み上げ] */
  const badges = {
    phases: [[state.leaks.length, 'hole', t('Gaps: {n}', { n: state.leaks.length })], [waits, 'wait', t('Pending approvals: {n}', { n: waits })]],
    trace: [[leakRows, 'hole', t('Rows with gaps: {n}', { n: leakRows })]],
  }
  document.querySelectorAll('nav a[data-view]').forEach(el => {
    const a = /** @type {HTMLAnchorElement} */ (el)
    a.querySelector('.nav-badges')?.remove()
    const shown = (badges[a.dataset.view ?? ''] ?? []).filter(([n]) => n > 0)
    if (!shown.length) return
    const holder = document.createElement('span')
    holder.className = 'nav-badges'
    for (const [n, tone, label] of shown) {
      const b = document.createElement('span')
      b.className = `nav-badge ${tone}`
      b.textContent = String(n)
      b.title = label
      b.setAttribute('aria-label', label)
      holder.appendChild(b)
    }
    a.appendChild(holder)
  })
}

function route() {
  if (!state) return
  const hash = decodeURIComponent(location.hash.slice(1))
  // #trace-F-02・#browse-W-03 のように、画面の名前のあとに ID を付けて、その行を開ける（会議で URL を渡せるように）
  const withId = hash.match(/^(trace|browse|phases)-(.+)$/)
  const key = withId ? withId[1] : (VIEWS[hash] ? hash : 'phases')
  const id = withId ? withId[2] : undefined
  renderChrome(key)
  VIEWS[key].render(id)
}

/**
 * 検索で選ばれた先へ移る。ルールセットと用語は、その言葉で絞った状態で開く。
 * 同じ画面にいるときは hash が変わらないので、自分で描き直す。
 * @param {import('./search.js').SearchOpen} open
 */
function navigate(open) {
  if (open.query?.view === 'rules') setRulesQuery(open.query.value)
  if (open.query?.view === 'glossary') setGlossaryQuery(open.query.value)
  const hash = `#${open.hash}`
  if (location.hash === hash) route(); else location.hash = hash
}

/** 案件を読み直す（保存のあと・画面に戻ったとき。git pull した内容もここで反映される） */
/** いま動いている所（広い画面では中身の列、狭い画面ではページ全体） */
const scroller = () => {
  const main = document.querySelector('.main > main')
  return main && getComputedStyle(main).overflowY === 'auto' ? main : (document.scrollingElement ?? document.documentElement)
}

async function reload() {
  try {
    const top = scroller().scrollTop // 読み直しても、読んでいた位置から動かさない
    state = await api('/api/state')
    setKindLabels(state.labels?.kinds)
    route()
    scroller().scrollTop = top
  } catch (error) {
    view.innerHTML = `<h1>${esc(t('Could not read the project'))}</h1><div class="note">${ICON_INFO}<span>${esc(messageOf(error))}${(error instanceof ApiError ? error.problems : []).map(p => `<br>${esc(p)}`).join('')}</span></div>`
  }
}

window.addEventListener('hashchange', route)
// 別のウィンドウや git pull で台帳が変わっても、画面に戻ったら読み直す
window.addEventListener('focus', reload)
initSearch({ getState: () => state, navigate })
initDesktop()
// 1 日に 1 回、新しい版があるかを確かめ、あれば上の帯に札を出す
void checkUpdateQuietly(byId('summary'))
// 画面の裏の server が、元のコードより古い版で動いていたら知らせる
void warnIfServerStale(byId('summary'))

/**
 * ほかのアプリ（md-business など）や git pull で TSV が書き換わったら、その場で読み直す。
 * 画面の欄に打っている途中なら、その欄から離れたときに読み直す（打っている文字を消さないため）。
 */
let reloadPending = false
function reloadFromElsewhere() {
  const el = document.activeElement
  if (el && view.contains(el) && ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) { reloadPending = true; return }
  reload().then(() => toast(t('Applied changes made in another app'), 2000))
}
view.addEventListener('focusout', () => { if (reloadPending) { reloadPending = false; setTimeout(reloadFromElsewhere, 0) } })
if ('EventSource' in window) {
  const events = new EventSource('/api/events')
  events.addEventListener('changed', reloadFromElsewhere)
  initAgent(events, toast) // エージェントの専用カーソル（人のマウスは使わない）
}
reload()
