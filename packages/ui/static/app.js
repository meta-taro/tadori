// tadori の画面の入口：/api/state を読み、#名前 で画面を切り替える
import { api, chip, esc, ICON_INFO, setKindLabels, toast } from './util.js'
import { renderGates } from './view-gates.js'
import { renderWbs } from './view-wbs.js'
import { renderLog, renderRules, renderTrace } from './view-records.js'
import { renderSettings } from './view-settings.js'
import { renderGlossary } from './view-glossary.js'

const view = document.getElementById('view')
let state = null

const VIEWS = {
  browse: { label: 'プロダクト', render: id => renderWbs(view, state, reload, id) },
  phases: { label: 'リリースまでの残課題', render: () => renderGates(view, state, id => { location.hash = `trace-${encodeURIComponent(id)}` }) },
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
  const withId = hash.match(/^(trace|browse)-(.+)$/)
  const key = withId ? withId[1] : (VIEWS[hash] ? hash : 'phases')
  const id = withId ? withId[2] : undefined
  renderChrome(key)
  VIEWS[key].render(id)
}

/**
 * 「ID で開く」：会議で聞いた番号へすぐ飛ぶ。大文字・小文字は区別しない。
 * タスクはプロダクト（WBS）のその行へ、台帳のほかの行はつながりを辿るで開く。漏れの呼び名（R4·DD-2.3）は行の ID で開く。
 */
function jumpTo(raw) {
  const wanted = raw.trim().split(/[·・]/).at(-1)?.trim().toLowerCase() ?? ''
  if (!wanted) return
  const item = state.items.find(i => i.id.toLowerCase() === wanted)
  if (!item) { toast(`「${raw.trim()}」は台帳にもタスクにもありません`); return }
  const isTask = state.tasks.some(t => t.id === item.id)
  location.hash = `${isTask ? 'browse' : 'trace'}-${encodeURIComponent(item.id)}`
}

function bindJump() {
  const form = document.getElementById('jump')
  const input = document.getElementById('jump-input')
  form.addEventListener('submit', e => { e.preventDefault(); jumpTo(input.value); input.value = ''; input.blur() })
  // 「/」で ID の欄へ（文字を打っている途中は横取りしない）
  document.addEventListener('keydown', e => {
    const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName ?? '')
    if (e.key === '/' && !typing) { e.preventDefault(); input.focus() }
  })
}

/** 案件を読み直す（保存のあと・画面に戻ったとき。git pull した内容もここで反映される） */
async function reload() {
  try {
    state = await api('/api/state')
    setKindLabels(state.labels?.kinds)
    route()
  } catch (error) {
    view.innerHTML = `<h1>案件を読めませんでした</h1><div class="note">${ICON_INFO}<span>${esc(error.message)}${(error.problems ?? []).map(p => `<br>${esc(p)}`).join('')}</span></div>`
  }
}

window.addEventListener('hashchange', route)
// 別のウィンドウや git pull で台帳が変わっても、画面に戻ったら読み直す
window.addEventListener('focus', reload)
bindJump()
reload()
