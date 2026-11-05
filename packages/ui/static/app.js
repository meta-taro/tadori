// tadori の画面の入口：/api/state を読み、#名前 で画面を切り替える
import { api, chip, esc, ICON_INFO, setKindLabels } from './util.js'
import { renderGates } from './view-gates.js'
import { renderWbs } from './view-wbs.js'
import { renderLog, renderRules, renderTrace } from './view-records.js'
import { renderSettings } from './view-settings.js'
import { renderGlossary } from './view-glossary.js'

const view = document.getElementById('view')
let state = null

const VIEWS = {
  browse: { label: 'プロダクト', render: () => renderWbs(view, state, reload) },
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
}

function route() {
  if (!state) return
  const hash = decodeURIComponent(location.hash.slice(1))
  // #trace-F-02 のように、つながりを辿るは辿り始めの ID を持てる
  const [key, traceId] = hash.startsWith('trace-') ? ['trace', hash.slice('trace-'.length)] : [VIEWS[hash] ? hash : 'phases', undefined]
  renderChrome(key)
  VIEWS[key].render(traceId)
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
reload()
