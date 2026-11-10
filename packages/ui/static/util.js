// 画面で共通に使う小さな道具。データはすべて /api から読み、ここでは控えを持たない
import { lang, t } from './i18n.js'

/** @type {Readonly<Record<string, string>>} */
const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
export const esc = (/** @type {unknown} */ s) => String(s ?? '').replace(/[&<>"']/g, c => HTML_ESCAPES[c] ?? c)

export const chip = (/** @type {string} */ cls, /** @type {string | number} */ text) => `<span class="chip ${cls}"><span class="dot"></span>${text}</span>`

const MS_PER_DAY = 86_400_000
export const day = (/** @type {string} */ iso) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / MS_PER_DAY)
export const shortDate = (/** @type {string} */ iso) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8))}`
// 日付は読み込み時に形を確かめているが、画面に埋め込む前にも念のためエスケープする
export const fullDate = (/** @type {string} */ iso) => esc(String(iso).replaceAll('-', '/'))

export const ICON_INFO = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="8" cy="8" r="6.2"/><path d="M8 7.2v4M8 4.8v.2"/></svg>'

/**
 * 台帳の種類の読み方（画面での呼び名）
 * @type {Readonly<Record<string, string>>}
 */
export const KIND_LABELS = {
  W: 'WBS task', BD: 'basic design section', DD: 'detailed design section', Q: 'open question', COMMIT: 'source change',
  V: 'test viewpoint', TC: 'test case', RUN: 'test run', F: 'finding', R: 'preventive action',
}
// 案件の設定（.tadori/kinds.tsv）の読み方を先に使い、無ければ既定の読み方、それも無ければ記号のまま
/** @type {Readonly<Record<string, string>>} */
let projectKinds = {}
export const setKindLabels = (/** @type {Readonly<Record<string, string>> | undefined} */ kinds) => { projectKinds = kinds ?? {} }
export const kindLabel = (/** @type {string} */ kind) => projectKinds[kind] ?? (KIND_LABELS[kind] ? t(KIND_LABELS[kind] ?? '') : kind)

/** 遅れの色：予定どおりは青、終了予定を過ぎた日数に応じて赤へ（14 日で真っ赤） */
const RED_AT_LATE_DAYS = 14
/** @param {number} days */
export function lateColor(days) {
  const pct = Math.round(Math.min(days, RED_AT_LATE_DAYS) / RED_AT_LATE_DAYS * 100)
  return `color-mix(in oklch, var(--late-red) ${pct}%, var(--late-blue))`
}

/**
 * 画面全体の「担当」の絞り込み（上の帯で選ぶ。どの画面も同じものを使う）。
 * 選んだ人は、その PC のブラウザに覚える（人の好みなので、案件の設定には書かない）。
 */
const WHO_KEY = 'tadori-who'
let currentWho = (() => { try { return localStorage.getItem(WHO_KEY) ?? '' } catch { return '' } })()
export const getWho = () => currentWho
/** @param {string | null | undefined} value */
export function setWho(value) {
  currentWho = value ?? ''
  try { localStorage.setItem(WHO_KEY, currentWho) } catch { /* 覚えられなくても、いまの画面には効かせる */ }
}

const ICON_FILTER = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M2.5 3.5h11l-4.2 5v4l-2.6 1.2V8.5z"/></svg>'

/**
 * 上の帯の担当で絞っていることを示す札。× を押すと全員に戻る（どの画面も同じ形）。
 * 絞っていなければ空
 */
export function whoFilterChip() {
  const who = getWho()
  if (!who) return ''
  return `<span class="filter-chip" title="${esc(t('Every screen shows only this person\'s items. Change it with Owner in the top bar'))}">${ICON_FILTER}<span>${esc(t('Owner: {who}', { who }))}</span><button type="button" data-clear-who aria-label="${esc(t('Show everyone'))}">×</button></span>`
}

const ICON_PERSON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="8" cy="5.5" r="2.4"/><path d="M3.4 13.5c.6-2.4 2.4-3.7 4.6-3.7s4 1.3 4.6 3.7"/></svg>'
const ICON_AUTO = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="3" y="3" width="10" height="10" rx="2"/><path d="M6 1.5v1.5M10 1.5v1.5M6 13v1.5M10 13v1.5M1.5 6h1.5M1.5 10h1.5M13 6h1.5M13 10h1.5"/></svg>'
const ICON_NOTE = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M4 2.5h6l2.5 2.5v8.5h-8.5z"/><path d="M6 7h4.5M6 9.5h4.5"/></svg>'
export const ICON_LINK = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M6.5 9.5l3-3M7 4.5l1-1a2.5 2.5 0 0 1 3.5 3.5l-1 1M9 11.5l-1 1a2.5 2.5 0 0 1-3.5-3.5l1-1"/></svg>'

/**
 * 担当の札（人の印と名前）。「A・B」は人ごとに分けて並べる。担当が無ければ空
 * @param {string | null | undefined} owner
 */
export function personChips(owner) {
  return ownersOf(owner).map(name => `<span class="person">${ICON_PERSON}<span>${esc(name)}</span></span>`).join('')
}

/**
 * 判定の別の札：人の承認・機械の判定・判定しない約束。name を渡すと、札の文字にする（例：判定の種類の名前）
 * @param {string} kind ルールの判定の種類
 * @param {string} [name]
 */
export function judgeBadge(kind, name) {
  const [icon, tone, word] = kind === 'approval' ? [ICON_PERSON, 'judge-human', 'Human'] : kind === 'note' ? [ICON_NOTE, 'judge-note', 'Not checked'] : [ICON_AUTO, 'judge-auto', 'Machine']
  return `<span class="judge ${tone}">${icon}<span>${esc(name ?? t(word))}</span></span>`
}

/**
 * ID の札（等幅・小さな角丸）。href を渡すとリンクにする
 * @param {string} id
 * @param {string} [href]
 * @param {string} [title]
 */
export function idPill(id, href, title) {
  const attrs = title ? ` title="${esc(title)}"` : ''
  return href ? `<a class="id-pill" href="${esc(href)}"${attrs}>${esc(id)}</a>` : `<span class="id-pill"${attrs}>${esc(id)}</span>`
}

/** 担当の欄を人ごとに分ける（「A・B」「A、B」「A,B」「A/B」） */
export const ownersOf = (/** @type {string | null | undefined} */ owner) => String(owner ?? '').split(/[・、,，/／]/).map(s => s.trim()).filter(Boolean)

/**
 * owner の欄が、選んでいる人の分か（判定の核の isFor と同じ決まり）。
 * 名前の一致か、その人の役割（.tadori/members.tsv の roles）の一致。だれも選んでいなければ全部。
 * @param {import('./types').ProjectState} state
 * @param {string | null | undefined} owner
 */
export function isMine(state, owner) {
  const who = currentWho
  if (!who) return true
  const names = ownersOf(owner)
  const roles = state.members?.find(m => m.name === who)?.roles ?? []
  return names.includes(who) || names.some(n => roles.includes(n))
}

/** 担当の選択肢：人の表の名前と、WBS の担当（人）。役割だけの名前は出さない */
export const peopleOf = (/** @type {import('./types').ProjectState} */ state) => [...new Set([...(state.members ?? []).map(m => m.name), ...state.tasks.flatMap(t => ownersOf(t.owner))])]

/** 終わったステータス（設定で色の意味が ok のもの）か */
export const isDoneStatus = (/** @type {import('./types').ProjectState} */ state, /** @type {string} */ status) => state.statuses.some(s => s.id === status && s.tone === 'ok')

/**
 * 終了予定を過ぎた日数（判定の核と同じ数え方）
 * @param {import('./types').ProjectState} state
 * @param {import('./types').Task} task
 */
export function lateDays(state, task) {
  if (isDoneStatus(state, task.status) || !task.end) return 0
  return Math.max(0, day(state.today) - day(task.end))
}

/** API が断ったときの誤り（problems に、設定の読み込みで見つかった問題が並ぶ） */
export class ApiError extends Error {
  /** @param {string} message @param {string[]} problems */
  constructor(message, problems) {
    super(message)
    this.name = 'ApiError'
    this.problems = problems
  }
}

/** 誤りを人に見せる 1 行にする（Error でないものが投げられても落ちないように） */
export const messageOf = (/** @type {unknown} */ error) => (error instanceof Error ? error.message : String(error))

/**
 * API を呼ぶ。書き込みには x-tadori ヘッダを付ける（ほかのサイトからの書き込みを防ぐため）
 * @param {string} path
 * @param {{ method?: string, body?: unknown }} [options]
 * @returns {Promise<any>}
 */
export async function api(path, { method = 'GET', body } = {}) {
  // 書き込み（GET 以外）は、本文が無くても（DELETE など）x-tadori を付けて JSON で送る。
  // サーバーは x-tadori と JSON の両方がそろった書き込みだけを受ける（ほかのサイトからの書き込みを防ぐ）
  const isWrite = method !== 'GET'
  const res = await fetch(path, {
    method,
    // 画面で選んでいる言語を添える（サーバーの誤りの文などを、その言語で返してもらう）
    headers: isWrite ? { 'content-type': 'application/json', 'x-tadori': '1', 'x-tadori-lang': lang } : { 'x-tadori-lang': lang },
    ...(isWrite ? { body: JSON.stringify(body ?? {}) } : {}),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    // server の中で落ちたときは、手元に残した記録の場所も出す（どこで何が落ちたかを後から確かめられるように）
    const where = data.logFile ? t(' (log: {file})', { file: data.logFile }) : ''
    throw new ApiError(`${data.error ?? t('The server returned {status}', { status: res.status })}${where}`, data.problems ?? [])
  }
  return data
}

/** @type {ReturnType<typeof setTimeout> | undefined} */
let toastTimer
/**
 * 画面の下に短い知らせを出す（alert は使わない）
 * @param {string} message
 */
export function toast(message, durationMs = 4000) {
  const el = /** @type {HTMLElement} */ (document.getElementById('toast'))
  el.textContent = message
  el.classList.add('show')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => el.classList.remove('show'), durationMs)
}

/**
 * 保存の結果（commit したか、しなかった理由）を知らせる
 * @param {string} what 保存したもの（いまの言語に訳した名前。例：t('the rule')）
 * @param {import('./types').CommitResult} commit
 */
export function toastCommit(what, commit) {
  if (!commit.committed) { toast(t('Saved {what}. {reason}', { what, reason: commit.reason ?? '' })); return }
  // tadori は push しない。push していない commit があることを知らせ、中身を確かめてから人が push する
  const pushNote = commit.unpushed === null || commit.unpushed === undefined
    ? t('No push destination is set. Set one before you push.')
    : t('{n} commits are not pushed yet. Check them before you push.', { n: commit.unpushed })
  toast(t('Saved and committed {what}. {note}', { what, note: pushNote }), 7000)
}

/** http・https の URL だけを通す（正本の表に書かれた URL でも、画面で押せるのはこれだけ） */
export const webUrl = (/** @type {unknown} */ url) => (/^https?:\/\//i.test(String(url ?? '')) ? String(url) : '')

/**
 * 正本へのリンクと、正本から手元へ反映した記録（例：「正本 ↗ · 反映 11/8 検証担当」）。
 * 反映が古い（設定の日数を超えた・記録が無い）ときは目立たせる。正本の表に無い行は空。
 * リンクは新しいタブ（デスクトップアプリでは OS のブラウザ）で開く。
 * @param {import('./types').Origin | undefined} origin
 */
export function originHtml(origin) {
  if (!origin) return ''
  const url = webUrl(origin.url)
  const name = `${esc(origin.name)}${origin.place ? ` ${esc(origin.place)}` : ''}`
  const link = url
    ? `<a class="origin-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer" data-external title="${esc(t('Open the source of truth: {url}', { url }))}">${name} ↗</a>`
    : `<span>${name}</span>`
  const when = origin.syncedAt ? `${esc(t('Synced'))} ${esc(origin.syncedAt.slice(5, 16).replace('-', '/'))}${origin.syncedBy ? ` ${esc(origin.syncedBy)}` : ''}` : esc(t('Never synced'))
  const title = origin.stale ? t('It has been a while since this row was synced from its source of truth (or there is no record). Compare it with the source.') : t('When this row was synced from its source of truth')
  return `<span class="origin ${origin.stale ? 'stale' : ''}">${link}<span class="origin-sync" title="${esc(title)}">${when}${origin.stale ? ` · ${esc(t('stale'))}` : ''}</span></span>`
}

/**
 * text の中で、word の nth 回目が始まる位置（無ければ -1）。1 日の進行の行のリンクの語（anchor）を探すのに使う
 * @param {string} text @param {string} word @param {number} [nth]
 */
export function nthIndexOf(text, word, nth = 1) {
  let at = -1
  for (let i = 0; i < nth; i += 1) {
    at = text.indexOf(word, at + 1)
    if (at < 0) return -1
  }
  return at
}

/**
 * ID で要素を取る。画面の骨組み（index.html）にあるはずのものが無いのは作りの誤りなので、黙って進まずに止める
 * @param {string} id
 * @returns {HTMLElement}
 */
export function byId(id) {
  const el = document.getElementById(id)
  if (!el) throw new Error(`#${id} is missing from the page`)
  return el
}

/**
 * root の中から要素を取る。直前に描いた中にあるはずのものが無いのは作りの誤りなので、黙って進まずに止める
 * @param {ParentNode} root
 * @param {string} selector
 * @returns {HTMLElement}
 */
export function within(root, selector) {
  const el = root.querySelector(selector)
  if (!(el instanceof HTMLElement)) throw new Error(`${selector} is missing from the page`)
  return el
}

