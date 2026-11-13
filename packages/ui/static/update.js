// ヘルプの「バージョンと更新」と、起動したときの新しい版の確認。
// 見に行くのは GitHub の公開リリースの「最新」だけ（サーバーの /api/update が代わりに見る）。案件の中身は送らない。
// ブラウザで開いた画面では入れ替えない（配布のページを開けるようにするだけ）。
// デスクトップアプリの窓では、押すと Rust 側（install_update）が新しい版を落とし、署名を確かめてから入れ替えて再起動する。
import { t } from './i18n.js'
import { api, esc, messageOf } from './util.js'

const LAST_CHECK_KEY = 'tadori-update-checked'
const CHECK_EVERY_MS = 24 * 60 * 60 * 1000

/** @param {string} url @param {string} label */
const outLink = (url, label) => `<a class="btn-primary update-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer" data-external>${esc(label)}</a>`

/** デスクトップアプリの窓か（Rust の命令を呼べるか） */
const desktopInvoke = () => /** @type {any} */ (window).__TAURI__?.core?.invoke

const installButton = () => `<button type="button" class="btn-primary" data-install>${esc(t('Update and restart'))}</button>`

/**
 * 押すと、新しい版を落として入れ替え、再起動する（デスクトップアプリだけ）。
 * 終わればアプリごと立ち上がり直すので、ここへ戻るのは失敗したときだけ
 * @param {HTMLElement} panel
 */
function wireInstall(panel) {
  const button = panel.querySelector('[data-install]')
  if (!(button instanceof HTMLButtonElement)) return
  button.addEventListener('click', async () => {
    const invoke = desktopInvoke()
    if (!invoke) return
    button.disabled = true
    const note = document.createElement('p')
    note.className = 'cond'
    note.setAttribute('role', 'status')
    note.textContent = t('Installing the new version. tadori restarts when it is done…')
    button.closest('.update-card')?.insertBefore(note, button.parentElement)
    try {
      await invoke('install_update')
    } catch (error) {
      note.textContent = t('Could not update: {reason}. Use the download page instead.', { reason: messageOf(error) })
      button.disabled = false
    }
  })
}

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
    <h2 id="update-title">${esc(t('Version and updates'))}</h2>${body}
    <div class="update-actions" data-actions></div>
    <button type="button" class="btn-ghost update-close" data-close aria-label="${esc(t('Close'))}">${esc(t('Close'))}</button>
  </div>`
}

/** ヘルプの「バージョンと更新」：いまの版を出し、新しい版があるかをその場で確かめる */
export async function showUpdatePanel() {
  const panel = openPanel()
  fill(panel, `<p class="cond">${esc(t('Checking…'))}</p>`)
  /** @type {{ version: string, builtAt?: string, commit?: string }} */
  const build = await api('/api/version').catch(() => ({ version: '' }))
  const version = build.version
  const builtNote = build.builtAt ? `<p class="cond">${esc(build.commit
    ? t('Server behind this screen: built {when} (UTC) · {commit}', { when: build.builtAt.slice(0, 16).replace('T', ' '), commit: build.commit })
    : t('Server behind this screen: built {when} (UTC)', { when: build.builtAt.slice(0, 16).replace('T', ' ') }))}</p>` : ''
  try {
    const info = await api('/api/update')
    remember(info)
    const status = info.isNewer
      ? `<p><b>${esc(t('Version {v} is available.', { v: info.latest }))}</b>${esc(t('You have {v}.', { v: info.current }))}</p>
         <p class="cond">${esc(t('Reinstall the build for the OS and CPU of this PC from the download page. Your project folders and settings keep working as they are.'))}</p>`
      : info.isSourceBuild
        // 手元でソースから組んだ版は、配った版の番号と比べられない（新しくするのは git pull と組み直し）
        ? `<p>${esc(t('This is a build made from the source code on this PC.'))}</p><p class="cond">${esc(t('It is not compared with the released versions. To update, pull the repository and build again.'))}</p>`
        : `<p>${esc(t('tadori {v} is up to date.', { v: info.current }))}</p>`
    fill(panel, status + builtNote)
    const actions = panel.querySelector('[data-actions]')
    const install = info.isNewer && desktopInvoke() ? installButton() : ''
    if (actions) actions.innerHTML = info.isNewer ? `${install}${outLink(info.downloadUrl, t('Open the download page'))}${outLink(info.releaseUrl, t('What changed'))}` : outLink(info.releaseUrl, t('Release page'))
    wireInstall(panel)
  } catch (error) {
    fill(panel, `<p>tadori ${esc(version || t('(version unknown)'))}</p><p class="cond">${esc(messageOf(error))}</p>`)
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
  chip.textContent = t('New version {v}', { v: info.latest })
  chip.title = t('Open version and updates')
  chip.addEventListener('click', () => { void showUpdatePanel() })
  before.before(chip)
}

/**
 * 画面の裏の server が、元のコードより古い版で動いていたら上の帯に知らせる（新しい画面と食い違って落ちる前に気づけるように）。
 * 配る版では元のコードが無いので出ない
 * @param {HTMLElement} before この要素の前に札を置く
 */
export async function warnIfServerStale(before) {
  /** @type {{ isStale?: boolean, builtAt?: string, commit?: string } | null} */
  const info = await api('/api/version').catch(() => null)
  if (!info?.isStale || document.querySelector('.stale-chip')) return
  const chip = document.createElement('span')
  chip.className = 'chip hole stale-chip'
  chip.textContent = t('The server is an old build')
  chip.title = t('The server behind this screen was built at {when} ({commit}), and the source code has changed since. Run pnpm build, then reopen the project.', { when: info.builtAt ?? '?', commit: info.commit || t('unknown commit') })
  before.before(chip)
}
