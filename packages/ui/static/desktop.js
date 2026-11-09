// デスクトップアプリ（Tauri）の窓で開いたときだけ、上の帯を自作のタイトルバーにする：
// 帯をつかんで窓を動かす・ダブルクリックで最大化、左にメニュー（ファイル・表示・ヘルプ）、右に最小化・最大化・閉じる。
// ブラウザで開いたときは何もしない（window.__TAURI__ が無い）。
// 呼べるのは、窓の操作と、案件を開く 3 つの命令と、正本を OS のブラウザで開く命令だけ（それ以外は Tauri の側で断られる）
import { esc, toast } from './util.js'
import { showUpdatePanel } from './update.js'

const tauri = window.__TAURI__

/**
 * Rust 側の命令を呼ぶ（デスクトップアプリの窓の中だけ）
 * @template T
 * @param {string} command
 * @param {Record<string, unknown>} [args]
 * @returns {Promise<T>}
 */
const invoke = (command, args) => (tauri ? tauri.core.invoke(command, args) : Promise.reject(new Error('デスクトップアプリの窓ではありません')))

/** 押しても窓を動かさない所（欄・ボタン・リンク・メニュー） */
const INTERACTIVE = 'input, button, a, select, textarea, label, .win-menu, .win-controls, .search-panel'

const THEMES = [['light', 'ライト'], ['dark', 'ダーク'], ['system', 'OS に合わせる']]

export function initDesktop() {
  if (!tauri?.window || !tauri?.core) return
  const win = tauri.window.getCurrentWindow()
  const topbar = /** @type {HTMLElement} */ (document.querySelector('.topbar'))
  document.documentElement.classList.add('desktop')
  // 正本へのリンクは、窓の中で外のページへ移らず、OS の既定のブラウザで開く（Rust 側で http・https だけを受ける）
  document.addEventListener('click', e => {
    const link = e.target instanceof Element ? e.target.closest('a[data-external]') : null
    if (!(link instanceof HTMLAnchorElement)) return
    e.preventDefault()
    invoke('open_external', { url: link.href }).catch(error => toast(String(error)))
  })

  topbar.insertAdjacentHTML('afterbegin', `<div class="win-menu" role="menubar" aria-label="メニュー">
    <button type="button" data-menu="file" aria-haspopup="true" aria-expanded="false">ファイル</button>
    <button type="button" data-menu="view" aria-haspopup="true" aria-expanded="false">表示</button>
    <button type="button" data-menu="help" aria-haspopup="true" aria-expanded="false">ヘルプ</button>
    <div class="menu-panel" role="menu" hidden></div>
  </div>`)
  topbar.insertAdjacentHTML('beforeend', `<div class="win-controls">
    <button type="button" data-win="minimize" title="最小化" aria-label="最小化"><svg viewBox="0 0 10 10"><path d="M1 5h8"/></svg></button>
    <button type="button" data-win="maximize" title="最大化 / 元に戻す" aria-label="最大化 / 元に戻す"><svg viewBox="0 0 10 10"><rect x="1.5" y="1.5" width="7" height="7"/></svg></button>
    <button type="button" data-win="close" class="close" title="閉じる" aria-label="閉じる"><svg viewBox="0 0 10 10"><path d="M1.5 1.5l7 7M8.5 1.5l-7 7"/></svg></button>
  </div>`)

  // 帯の空いている所をつかむと窓が動く。ダブルクリックで最大化 / 元に戻す
  topbar.addEventListener('mousedown', e => {
    if (e.button !== 0 || (e.target instanceof Element && e.target.closest(INTERACTIVE))) return
    if (e.detail === 2) win.toggleMaximize(); else win.startDragging()
  })
  document.querySelector('aside .brand')?.addEventListener('mousedown', e => { if (/** @type {MouseEvent} */ (e).button === 0) win.startDragging() })

  topbar.querySelector('[data-win="minimize"]')?.addEventListener('click', () => win.minimize())
  topbar.querySelector('[data-win="maximize"]')?.addEventListener('click', () => win.toggleMaximize())
  topbar.querySelector('[data-win="close"]')?.addEventListener('click', () => win.close())

  // メニューの帯は画面の骨組み（index.html）にかならずある
  initMenus(/** @type {HTMLElement} */ (topbar.querySelector('.win-menu')))
}

/** @param {HTMLElement} bar */
function initMenus(bar) {
  const panel = /** @type {HTMLElement} */ (bar.querySelector('.menu-panel'))
  const buttons = /** @type {NodeListOf<HTMLElement>} */ (bar.querySelectorAll('[data-menu]'))
  /** @type {string | null | undefined} いま開いているメニュー（file・view・help） */
  let openKey = null

  const close = () => {
    openKey = null
    panel.hidden = true
    buttons.forEach(b => b.setAttribute('aria-expanded', 'false'))
  }
  const open = async (/** @type {HTMLElement} */ button) => {
    openKey = button.dataset.menu
    buttons.forEach(b => b.setAttribute('aria-expanded', String(b === button)))
    panel.style.left = `${button.offsetLeft}px`
    panel.innerHTML = await menuHtml(openKey)
    panel.hidden = false
  }

  buttons.forEach(button => {
    button.addEventListener('click', () => (openKey === button.dataset.menu ? close() : open(button)))
    // 1 つ開いているときは、隣に指を動かすだけで切り替える（ふつうのメニューバーと同じ）
    button.addEventListener('mouseenter', () => { if (openKey && openKey !== button.dataset.menu) open(button) })
  })
  panel.addEventListener('click', e => {
    const item = /** @type {HTMLElement | null} */ (/** @type {Element} */ (e.target).closest('[data-action]'))
    if (!item) return
    close()
    runAction(item.dataset.action, item.dataset.value)
  })
  document.addEventListener('mousedown', e => { if (openKey && !bar.contains(/** @type {Node | null} */ (e.target))) close() })
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && openKey) close() })
}

/** @param {string | null | undefined} key */
async function menuHtml(key) {
  if (key === 'file') {
    /** @type {Array<[string, string]>} */
    const recent = await invoke('recent_projects').catch(() => [])
    const items = recent.map(([path, name], i) =>
      `<button type="button" role="menuitem" data-action="open" data-value="${esc(path)}" title="${esc(path)}">${i === 0 ? '<span class="check">✓</span>' : '<span class="check"></span>'}${esc(name)}</button>`).join('')
    return `<button type="button" role="menuitem" data-action="pick"><span class="check"></span>案件を開く…</button>
      <button type="button" role="menuitem" data-action="pick"><span class="check"></span>新しく始める…</button>
      ${items ? `<div class="menu-sep"></div><div class="menu-head">最近の案件</div>${items}` : ''}`
  }
  if (key === 'view') {
    const current = window.tadoriTheme?.choice() ?? 'light'
    return THEMES.map(([value, label]) =>
      `<button type="button" role="menuitemradio" aria-checked="${value === current}" data-action="theme" data-value="${value}"><span class="check">${value === current ? '✓' : ''}</span>${label}</button>`).join('')
      + '<div class="menu-sep"></div><button type="button" role="menuitem" data-action="reload"><span class="check"></span>読み直す</button>'
  }
  return `<button type="button" role="menuitem" data-action="glossary"><span class="check"></span>用語</button>
    <button type="button" role="menuitem" data-action="version"><span class="check"></span>バージョンと更新…</button>
    <button type="button" role="menuitem" data-action="about"><span class="check"></span>tadori について</button>`
}

/**
 * @param {string | undefined} action
 * @param {string | undefined} value
 */
function runAction(action, value) {
  if (action === 'pick') invoke('pick_project').catch(error => toast(String(error)))
  if (action === 'open') invoke('open_project', { path: value }).catch(error => toast(String(error)))
  if (action === 'theme') window.tadoriTheme?.set(value ?? '')
  if (action === 'reload') location.reload()
  if (action === 'glossary') location.hash = '#glossary'
  if (action === 'version') void showUpdatePanel()
  if (action === 'about') toast('tadori — 仕様から試験・指摘までのつながりと、リリースまでの残課題を出す道具（判定は CLI と同じ核）', 4000)
}
