// ヘルプの「バージョンと更新」と、起動したときの新しい版の確認。
// 見に行くのは GitHub の公開リリースの「最新」だけ（サーバーの /api/update が代わりに見る）。案件の中身は送らない。
// 入れ替えはしない。新しい版があれば、配布のページを OS のブラウザで開けるようにする。
import { api, esc, messageOf } from './util.js'

const LAST_CHECK_KEY = 'tadori-update-checked'
const CHECK_EVERY_MS = 24 * 60 * 60 * 1000

/** @param {string} url @param {string} label */
const outLink = (url, label) => `<a class="btn-primary update-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer" data-external>${esc(label)}</a>`

/** 画面の真ん中に出す小さな窓（alert は使わない。押すまで画面を止めない） */
function openPanel() {
  document.querySelector('.update-panel')?.remove()
  const panel = document.createElement('div')
  panel.className = 'update-panel'
  panel.setAttribute('role', 'dialog')
  panel.setAttribute('aria-modal', 'false')
  panel.setAttribute('aria-labelledby', 'update-title')
  document.body.appendChild(panel)
  const close = () => { panel.remove(); document.removeEventListener('keydown', onKey) }
  const onKey = (/** @type {KeyboardEvent} */ e) => { if (e.key === 'Escape') close() }
  document.addEventListener('keydown', onKey)
  panel.addEventListener('click', e => { if (e.target instanceof Element && e.target.closest('[data-close], .update-link')) close() })
  return panel
}

/** @param {HTMLElement} panel @param {string} body */
const fill = (panel, body) => {
  panel.innerHTML = `<div class="update-card">
    <h2 id="update-title">バージョンと更新</h2>${body}
    <div class="update-actions" data-actions></div>
    <button type="button" class="btn-ghost update-close" data-close aria-label="閉じる">閉じる</button>
  </div>`
}

/** ヘルプの「バージョンと更新」：いまの版を出し、新しい版があるかをその場で確かめる */
export async function showUpdatePanel() {
  const panel = openPanel()
  fill(panel, '<p class="cond">確かめています…</p>')
  /** @type {{ version: string }} */
  const { version } = await api('/api/version').catch(() => ({ version: '' }))
  try {
    const info = await api('/api/update')
    remember(info)
    const status = info.isNewer
      ? `<p><b>新しい版 ${esc(info.latest)} があります。</b>いまは ${esc(info.current)} です。</p>
         <p class="cond">配布のページから、この PC の OS と CPU に合うものを入れ直してください。案件のフォルダや設定はそのまま使えます。</p>`
      : `<p>tadori ${esc(info.current)} は最新です。</p>`
    fill(panel, status)
    const actions = panel.querySelector('[data-actions]')
    if (actions) actions.innerHTML = info.isNewer ? `${outLink(info.downloadUrl, '配布のページを開く')}${outLink(info.releaseUrl, '変わったこと')}` : outLink(info.releaseUrl, 'リリースのページ')
  } catch (error) {
    fill(panel, `<p>tadori ${esc(version || '（版が読めません）')}</p><p class="cond">${esc(messageOf(error))}</p>`)
  }
}

/**
 * @param {{ latest: string, isNewer: boolean }} info
 * 確かめた日時と結果を手元に覚える（1 日に何度も見に行かない）
 */
function remember(info) {
  try { localStorage.setItem(LAST_CHECK_KEY, JSON.stringify({ at: Date.now(), latest: info.latest, isNewer: info.isNewer })) } catch { /* 覚えられなくても、確かめた結果はいまの画面に出す */ }
}

/** @returns {{ at: number, latest: string, isNewer: boolean } | null} */
function recalled() {
  try { return JSON.parse(localStorage.getItem(LAST_CHECK_KEY) ?? 'null') } catch { return null }
}

/**
 * 起動したときに、1 日に 1 回だけ新しい版があるかを確かめ、あれば上の帯に札を出す（押すと「バージョンと更新」）。
 * 繋がらないときは黙って次の機会に回す（画面の邪魔をしない。ヘルプから確かめれば理由が出る）
 * @param {HTMLElement} before この要素の前に札を置く（上の帯の件数の札の前）
 */
export async function checkUpdateQuietly(before) {
  const last = recalled()
  let info = last && Date.now() - last.at < CHECK_EVERY_MS ? last : null
  if (!info) {
    try {
      info = await api('/api/update')
      if (info) remember(info)
    } catch {
      return
    }
  }
  if (!info?.isNewer || document.querySelector('.update-chip')) return
  const chip = document.createElement('button')
  chip.type = 'button'
  chip.className = 'chip update-chip'
  chip.textContent = `新しい版 ${info.latest}`
  chip.title = 'バージョンと更新を開く'
  chip.addEventListener('click', () => { void showUpdatePanel() })
  before.before(chip)
}
