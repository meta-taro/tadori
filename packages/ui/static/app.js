// tadori の画面の入口：/api/state を読み、#名前 で画面を切り替える
import { api, chip, esc, ICON_INFO, setKindLabels, toast } from './util.js'
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

const view = document.getElementById('view')
let state = null

const VIEWS = {
  browse: { label: 'プロダクト', render: id => renderWbs(view, state, reload, id) },
  phases: { label: 'リリースまでの残課題', render: phaseId => renderGates(view, state, id => { location.hash = `trace-${encodeURIComponent(id)}` }, phaseId) },
  daily: { label: '1 日の進行', render: () => renderDaily(view, state) },
  rules: { label: 'ルールセット', render: () => renderRules(view, state) },
  log: { label: 'チェックの記録', render: () => renderLog(view, state) },
  trace: { label: 'つながりを辿る', render: id => renderTrace(view, state, id ?? defaultTraceStart()) },
  settings: { label: '設定', render: () => renderSettings(view, state, reload) },
  glossary: { label: '用語', render: () => renderGlossary(view) },
}

/** つながりを辿るの最初の行：漏れのある指摘、無ければ漏れのある行、無ければ指摘（何も無ければ選んでもらう） */
function defaultTraceStart() {
  const leakIds = new Set(state.leaks.map(l => l.itemId))
  const pick = state.items.find(i => i.kind === 'F' && leakIds.has(i.id))
    ?? state.items.find(i => leakIds.has(i.id))
    ?? state.items.find(i => i.kind === 'F')
  return pick?.id ?? ''
}

function renderChrome(key) {
  const waits = state.gates.reduce((n, g) => n + g.pendingApprovals.length, 0)
  document.getElementById('summary').innerHTML = chip('hole', `漏れ ${state.leaks.length} 件`) + chip('wait', `承認待ち ${waits} 件`)
  document.getElementById('side-project').textContent = state.project.name
  document.getElementById('crumb-project').textContent = state.project.name
  document.getElementById('crumb-view').textContent = VIEWS[key].label
  document.title = `tadori · ${VIEWS[key].label}`
  document.querySelectorAll('nav a').forEach(a => {
    if (a.dataset.view === key) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current')
  })
  renderNavBadges(waits)
}

/**
 * 左メニューに件数のバッジを出す。0 のときは出さない（全部直せば消える）。
 * 件数は事実として出すだけで、割合や点数にはしない。
 */
function renderNavBadges(waits) {
  const leakRows = new Set(state.leaks.map(l => l.itemId)).size
  const badges = {
    phases: [[state.leaks.length, 'hole', `漏れ ${state.leaks.length} 件`], [waits, 'wait', `承認待ち ${waits} 件`]],
    trace: [[leakRows, 'hole', `漏れのある行 ${leakRows} 件`]],
  }
  document.querySelectorAll('nav a[data-view]').forEach(a => {
    a.querySelector('.nav-badges')?.remove()
    const shown = (badges[a.dataset.view] ?? []).filter(([n]) => n > 0)
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
 */
function navigate(open) {
  if (open.query?.view === 'rules') setRulesQuery(open.query.value)
  if (open.query?.view === 'glossary') setGlossaryQuery(open.query.value)
  const hash = `#${open.hash}`
  if (location.hash === hash) route(); else location.hash = hash
}

/** 案件を読み直す（保存のあと・画面に戻ったとき。git pull した内容もここで反映される） */
async function reload() {
  try {
    const scrollY = window.scrollY // 読み直しても、読んでいた位置から動かさない
    state = await api('/api/state')
    setKindLabels(state.labels?.kinds)
    route()
    window.scrollTo(0, scrollY)
  } catch (error) {
    view.innerHTML = `<h1>案件を読めませんでした</h1><div class="note">${ICON_INFO}<span>${esc(error.message)}${(error.problems ?? []).map(p => `<br>${esc(p)}`).join('')}</span></div>`
  }
}

window.addEventListener('hashchange', route)
// 別のウィンドウや git pull で台帳が変わっても、画面に戻ったら読み直す
window.addEventListener('focus', reload)
initSearch({ getState: () => state, navigate })
initDesktop()

/**
 * ほかのアプリ（md-business など）や git pull で TSV が書き換わったら、その場で読み直す。
 * 画面の欄に打っている途中なら、その欄から離れたときに読み直す（打っている文字を消さないため）。
 */
let reloadPending = false
function reloadFromElsewhere() {
  const el = document.activeElement
  if (el && view.contains(el) && ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) { reloadPending = true; return }
  reload().then(() => toast('ほかのアプリでの変更を反映しました', 2000))
}
view.addEventListener('focusout', () => { if (reloadPending) { reloadPending = false; setTimeout(reloadFromElsewhere, 0) } })
if ('EventSource' in window) {
  const events = new EventSource('/api/events')
  events.addEventListener('changed', reloadFromElsewhere)
  initAgent(events, toast) // エージェントの専用カーソル（人のマウスは使わない）
}
reload()
