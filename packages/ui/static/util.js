// 画面で共通に使う小さな道具。データはすべて /api から読み、ここでは控えを持たない

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

export const chip = (cls, text) => `<span class="chip ${cls}"><span class="dot"></span>${text}</span>`

const MS_PER_DAY = 86_400_000
export const day = iso => Math.floor(Date.parse(`${iso}T00:00:00Z`) / MS_PER_DAY)
export const shortDate = iso => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8))}`
// 日付は読み込み時に形を確かめているが、画面に埋め込む前にも念のためエスケープする
export const fullDate = iso => esc(String(iso).replaceAll('-', '/'))

export const ICON_INFO = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="8" cy="8" r="6.2"/><path d="M8 7.2v4M8 4.8v.2"/></svg>'

/** 台帳の種類の読み方（画面での呼び名） */
export const KIND_LABELS = {
  W: 'WBS のタスク', BD: '基本設計の章', DD: '詳細設計の節', Q: '未確認の項目', COMMIT: 'ソースの変更',
  V: '観点', TC: '試験ケース', RUN: '試験の記録', F: '指摘', R: '再発防止',
}
// 案件の設定（.tadori/kinds.tsv）の読み方を先に使い、無ければ既定の読み方、それも無ければ記号のまま
let projectKinds = {}
export const setKindLabels = kinds => { projectKinds = kinds ?? {} }
export const kindLabel = kind => projectKinds[kind] ?? KIND_LABELS[kind] ?? kind

/** 遅れの色：予定どおりは青、終了予定を過ぎた日数に応じて赤へ（14 日で真っ赤） */
const RED_AT_LATE_DAYS = 14
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
export function setWho(value) {
  currentWho = value ?? ''
  try { localStorage.setItem(WHO_KEY, currentWho) } catch { /* 覚えられなくても、いまの画面には効かせる */ }
}

/** 担当の欄を人ごとに分ける（「A・B」「A、B」「A,B」「A/B」） */
export const ownersOf = owner => String(owner ?? '').split(/[・、,，/／]/).map(s => s.trim()).filter(Boolean)

/**
 * owner の欄が、選んでいる人の分か（判定の核の isFor と同じ決まり）。
 * 名前の一致か、その人の役割（.tadori/members.tsv の roles）の一致。だれも選んでいなければ全部。
 */
export function isMine(state, owner) {
  const who = currentWho
  if (!who) return true
  const names = ownersOf(owner)
  const roles = state.members?.find(m => m.name === who)?.roles ?? []
  return names.includes(who) || names.some(n => roles.includes(n))
}

/** 担当の選択肢：人の表の名前と、WBS の担当（人）。役割だけの名前は出さない */
export const peopleOf = state => [...new Set([...(state.members ?? []).map(m => m.name), ...state.tasks.flatMap(t => ownersOf(t.owner))])]

/** 終わったステータス（設定で色の意味が ok のもの）か */
export const isDoneStatus = (state, status) => state.statuses.some(s => s.id === status && s.tone === 'ok')

/** 終了予定を過ぎた日数（判定の核と同じ数え方） */
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
  const res = await fetch(path, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json', 'x-tadori': '1' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    // server の中で落ちたときは、手元に残した記録の場所も出す（どこで何が落ちたかを後から確かめられるように）
    const where = data.logFile ? `（記録：${data.logFile}）` : ''
    throw new ApiError(`${data.error ?? `サーバーが ${res.status} を返しました`}${where}`, data.problems ?? [])
  }
  return data
}

/** @type {ReturnType<typeof setTimeout> | undefined} */
let toastTimer
/** 画面の下に短い知らせを出す（alert は使わない） */
export function toast(message, durationMs = 4000) {
  const el = /** @type {HTMLElement} */ (document.getElementById('toast'))
  el.textContent = message
  el.classList.add('show')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => el.classList.remove('show'), durationMs)
}

/** 保存の結果（commit したか、しなかった理由）を知らせる */
export function toastCommit(what, commit) {
  if (!commit.committed) { toast(`${what}を保存しました。${commit.reason}`); return }
  // tadori は push しない。push していない commit があることを知らせ、中身を確かめてから人が push する
  const pushNote = commit.unpushed === null || commit.unpushed === undefined
    ? 'push 先が設定されていないので、push するときは設定してください'
    : `push していない commit が ${commit.unpushed} 件あります。中身を確かめてから push してください`
  toast(`${what}を保存して commit しました。${pushNote}`, 7000)
}

/** http・https の URL だけを通す（正本の表に書かれた URL でも、画面で押せるのはこれだけ） */
export const webUrl = url => (/^https?:\/\//i.test(String(url ?? '')) ? String(url) : '')

/**
 * 正本へのリンクと、正本から手元へ反映した記録（例：「正本 ↗ · 反映 11/8 検証担当」）。
 * 反映が古い（設定の日数を超えた・記録が無い）ときは目立たせる。正本の表に無い行は空。
 * リンクは新しいタブ（デスクトップアプリでは OS のブラウザ）で開く。
 */
export function originHtml(origin) {
  if (!origin) return ''
  const url = webUrl(origin.url)
  const name = `${esc(origin.name)}${origin.place ? ` ${esc(origin.place)}` : ''}`
  const link = url
    ? `<a class="origin-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer" data-external title="正本を開く：${esc(url)}">${name} ↗</a>`
    : `<span>${name}</span>`
  const when = origin.syncedAt ? `反映 ${esc(origin.syncedAt.slice(5, 16).replace('-', '/'))}${origin.syncedBy ? ` ${esc(origin.syncedBy)}` : ''}` : '反映の記録なし'
  const title = origin.stale ? '正本から手元へ反映してから日が経っています（または記録がありません）。正本と見比べてください' : '正本から手元へ反映した日時'
  return `<span class="origin ${origin.stale ? 'stale' : ''}">${link}<span class="origin-sync" title="${title}">${when}${origin.stale ? ' · 古い' : ''}</span></span>`
}

/**
 * ID で要素を取る。画面の骨組み（index.html）にあるはずのものが無いのは作りの誤りなので、黙って進まずに止める
 * @param {string} id
 * @returns {HTMLElement}
 */
export function byId(id) {
  const el = document.getElementById(id)
  if (!el) throw new Error(`画面に #${id} がありません`)
  return el
}
