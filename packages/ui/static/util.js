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

/** 終わったステータス（設定で色の意味が ok のもの）か */
export const isDoneStatus = (state, status) => state.statuses.some(s => s.id === status && s.tone === 'ok')

/** 終了予定を過ぎた日数（判定の核と同じ数え方） */
export function lateDays(state, task) {
  if (isDoneStatus(state, task.status) || !task.end) return 0
  return Math.max(0, day(state.today) - day(task.end))
}

/** API を呼ぶ。書き込みには x-tadori ヘッダを付ける（ほかのサイトからの書き込みを防ぐため） */
export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json', 'x-tadori': '1' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const error = new Error(data.error ?? `サーバーが ${res.status} を返しました`)
    error.problems = data.problems ?? []
    throw error
  }
  return data
}

let toastTimer = null
/** 画面の下に短い知らせを出す（alert は使わない） */
export function toast(message) {
  const el = document.getElementById('toast')
  el.textContent = message
  el.classList.add('show')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => el.classList.remove('show'), 4000)
}

/** 保存の結果（commit したか、しなかった理由）を知らせる */
export function toastCommit(what, commit) {
  toast(commit.committed ? `${what}を保存して commit しました（push は確かめてから手で）` : `${what}を保存しました。${commit.reason}`)
}
