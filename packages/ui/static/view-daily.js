// 1 日の進行：担当ごとに見て、その場で直す（プロダクト単位の残課題とは別に、人単位で見る）。
// 材料（WBS の状態の変化・台帳の差分・チェックの記録）から作った下書きを、日ごとのファイルに置き、行を足す・直す・消す。
// 直した行・足した行・消した行は、下書きを作り直しても上書きしない。
import { api, esc, getWho, ICON_INFO, messageOf, toast, toastCommit, webUrl, within } from './util.js'
import { previewHtml } from './daily-preview.js'

/** @typedef {import('./types').DailyEntry} DailyEntry */
/** @typedef {import('./types').Origin} Origin */
/** @typedef {Readonly<Record<string, Origin>>} Origins 行 ID → 正本へのリンクと反映の記録 */

// 担当は上の帯で選ぶ（どの画面も同じ）
let date = ''

// 台帳の整備（台帳の行を足した・直した）は、成果物の作業と読み違えないよう別の見出しにする。無い日は出さない
/** @type {Array<[string, string]>} */
const SECTIONS = [['today', '今日'], ['next', '次の作業日'], ['consult', '相談'], ['upkeep', '台帳の整備']]
/** @type {Readonly<Record<string, string>>} */
const ORIGIN_LABEL = { edited: '直した行', manual: '足した行' }
// 行の印（やり終えたことか、これからのことか）。文に出す言葉は案件の設定で決まる。画面の選択肢は意味で示す
/** @type {Array<[string, string]>} */
const TAGS = [['', '印なし'], ['done', 'やり終えた'], ['doing', '作業中'], ['plan', '予定'], ['upkeep', '台帳の整備'], ['checked', '確かめた']]
const tagSelect = (/** @type {DailyEntry} */ entry) => `<select class="inline-select daily-tag" data-tag="${esc(entry.id)}" aria-label="印">${TAGS.map(([v, l]) => `<option value="${v}" ${v === (entry.tag ?? '') ? 'selected' : ''}>${l}</option>`).join('')}</select>`

/**
 * 外のページを新しいタブ（デスクトップアプリでは OS のブラウザ）で開くリンク。URL は文字に出さない
 * @param {string} label
 * @param {string} url
 * @param {string} title
 * @param {string} [extra]
 */
const outLink = (label, url, title, extra = '') => `<a class="daily-link ${extra}" href="${esc(url)}" target="_blank" rel="noopener noreferrer" data-external title="${esc(title)}">${esc(label)} ↗</a>`

/** その作業でさわった正本の場所（エージェントや人が links で付けたもの） */
const entryLinks = (/** @type {DailyEntry} */ entry) => (entry.links ?? []).flatMap(l => (webUrl(l.url) ? [outLink(l.label, webUrl(l.url), `${l.label} を開く：${l.url}`)] : [])).join('')

/**
 * 課題の正本へ飛ぶ小さなリンク（会議の場で正本を開けるように）。表示名は正本の表の名前。反映が古ければ目立たせる
 * @param {Origin | undefined} origin
 */
function originLink(origin) {
  const url = webUrl(origin?.url)
  if (!origin || !url) return ''
  const sync = origin.syncedAt ? `反映 ${origin.syncedAt}${origin.syncedBy ? ` ${origin.syncedBy}` : ''}` : '反映の記録なし'
  return outLink(origin.name || '正本', url, `正本を開く（${sync}${origin.stale ? '・古い' : ''}）：${url}`, `origin-link ${origin.stale ? 'stale' : ''}`)
}

/**
 * 1 行：番号・本文（その場で直せる）・担当・課題と WBS へのリンク・消すボタン
 * @param {DailyEntry} entry
 * @param {number} no
 * @param {Origins} [origins]
 * @param {boolean} [isAll]
 */
function entryRow(entry, no, origins = {}, isAll = true) {
  const badge = ORIGIN_LABEL[entry.origin] ? `<span class="chip mono">${ORIGIN_LABEL[entry.origin]}</span>` : ''
  // 課題は「つながりを辿る」へ、WBS は「プロダクト」のその行へ（会議の場で、その場から開けるように）
  const issue = entry.issue ? `<a class="cond mono" href="#trace-${encodeURIComponent(entry.issue)}" title="${esc(entry.issue)} から辿る">${esc(entry.issue)}</a>` : ''
  const wbs = entry.wbs.map(id => `<a class="cond mono" href="#browse-${encodeURIComponent(id)}" title="WBS の ${esc(id)} を開く">${esc(id)}</a>`).join('')
  const origin = originLink(entry.issue ? origins[entry.issue] : undefined)
  return `<li class="daily-entry">
    <span class="daily-no">${no}.</span>
    ${tagSelect(entry)}
    ${isAll ? `<span class="daily-who" title="この行の担当">${esc(entry.who || '担当なし')}</span>` : ''}
    <input class="inline-input daily-text" data-entry="${esc(entry.id)}" value="${esc(entry.text)}" aria-label="${no} 番の本文" maxlength="500">
    <span class="daily-links">${origin}${entryLinks(entry)}</span>
    <span class="daily-meta">${badge}${issue}${wbs}</span>
    <button type="button" class="btn-ghost" data-remove="${esc(entry.id)}" aria-label="${no} 番を消す">消す</button>
  </li>`
}

/**
 * @param {readonly DailyEntry[]} entries
 * @param {Origins} [origins]
 */
function sectionsHtml(entries, origins = {}) {
  // 担当で絞っていないときは、見出しの横に「全員」、各行の頭に担当を出す（別の人の作業が混ざっていると一目で分かるように）
  const who = getWho()
  const isAll = !who
  const scope = `<span class="chip daily-scope">${isAll ? '全員' : esc(who)}</span>`
  let no = 0
  return SECTIONS.map(([id, label]) => {
    const list = entries.filter(e => e.section === id)
    if (id === 'upkeep' && !list.length) return ''
    const rows = list.map(e => entryRow(e, ++no, origins, isAll)).join('')
    return `<section class="daily-section"><h2>${label}${id === 'today' ? ` ${list.length}件` : ''}${scope}</h2>
      ${rows ? `<ol class="daily-list">${rows}</ol>` : `<p class="cond">${id === 'consult' ? '下の欄から足せます' : 'ありません'}</p>`}</section>`
  }).join('')
}

/**
 * 書き込んで結果を知らせ、描き直す（できなかったときも、いまのファイルの中身で描き直す）
 * @param {string} path
 * @param {string} method
 * @param {unknown} body
 * @param {string} what
 * @param {() => unknown} rerender
 */
async function write(path, method, body, what, rerender) {
  try {
    const result = await api(path, { method, body: body ?? {} })
    toastCommit(what, result.commit)
  } catch (error) {
    toast(`${what}できませんでした：${messageOf(error)}`)
  }
  rerender()
}

/**
 * @param {HTMLElement} view
 * @param {import('./types').ProjectState} state
 */
export async function renderDaily(view, state) {
  date ||= state.today
  const rerender = () => renderDaily(view, state)
  /** @type {import('./types').Daily} */
  let daily
  try {
    const who = getWho()
    daily = await api(`/api/daily?date=${encodeURIComponent(date)}${who ? `&who=${encodeURIComponent(who)}` : ''}`)
  } catch (error) {
    view.innerHTML = `<h1>1 日の進行</h1><div class="note">${ICON_INFO}<span>${esc(messageOf(error))}</span></div>`
    return
  }
  const base = `/api/daily/${encodeURIComponent(date)}`
  view.innerHTML = `
    <h1>1 日の進行</h1>
    <p class="lede">${daily.intro ? esc(daily.intro) : `担当ごとの 1 日の進行です。WBS の状態の変化・台帳の差分・チェックの記録から下書きを作ります。
      文はその場で直せます。直した行・足した行・消した行は、下書きを作り直しても残ります。`}</p>
    <div class="daily-bar">
      <label class="cond">日付 <input id="daily-date" class="inline-input" type="date" value="${esc(date)}"></label>
      <button type="button" class="btn-primary" id="daily-generate">${daily.saved ? '下書きを作り直す' : '下書きを作る'}</button>
      <button type="button" class="btn-ghost" id="daily-copy">文をコピー</button>
    </div>
    ${daily.saved ? '' : `<div class="note">${ICON_INFO}<span>まだ日ごとのファイルに置いていない下書きです。直したり足したりすると、その時点で置かれます。</span></div>`}
    <div class="panel daily-sheet">
      ${sectionsHtml(daily.entries, state.origins ?? {})}
      <form class="add" id="daily-add">
        <label>見出し<select name="section">${SECTIONS.map(([id, label]) => `<option value="${id}" ${id === 'consult' ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
        <label>担当<input name="who" value="${esc(getWho())}" maxlength="100"></label>
        <label class="grow">本文<input name="text" required maxlength="500" placeholder="例：試験の環境はいつ空くか確かめたい"></label>
        <div class="actions"><button type="submit" class="btn-primary">足す</button></div>
      </form>
    </div>
    <h2>文の形（補足つき）</h2>
    <div class="panel daily-preview">${previewHtml(daily.text, daily.links ?? [], daily.tags ?? [], daily.whoMarks ?? [])}</div>`

  const dateInput = /** @type {HTMLInputElement} */ (within(view, '#daily-date'))
  dateInput.addEventListener('change', () => { if (dateInput.value) { date = dateInput.value; rerender() } })
  within(view, '#daily-generate').addEventListener('click', () => write(`${base}/generate`, 'POST', {}, '1 日の進行の下書き', rerender))
  const entryInputs = /** @type {NodeListOf<HTMLInputElement>} */ (view.querySelectorAll('[data-entry]'))
  entryInputs.forEach(input => input.addEventListener('change', () =>
    write(`${base}/entries/${encodeURIComponent(input.dataset.entry ?? '')}`, 'PUT', { text: input.value }, '行', rerender)))
  const tagSelects = /** @type {NodeListOf<HTMLSelectElement>} */ (view.querySelectorAll('[data-tag]'))
  tagSelects.forEach(select => select.addEventListener('change', () =>
    write(`${base}/entries/${encodeURIComponent(select.dataset.tag ?? '')}`, 'PUT', { tag: select.value }, '印', rerender)))
  const removeButtons = /** @type {NodeListOf<HTMLButtonElement>} */ (view.querySelectorAll('[data-remove]'))
  removeButtons.forEach(button => button.addEventListener('click', () =>
    write(`${base}/entries/${encodeURIComponent(button.dataset.remove ?? '')}`, 'DELETE', {}, '行の削除', rerender)))
  const addForm = /** @type {HTMLFormElement} */ (within(view, '#daily-add'))
  addForm.addEventListener('submit', e => {
    e.preventDefault()
    const f = new FormData(addForm)
    write(`${base}/entries`, 'POST', { section: f.get('section'), who: String(f.get('who') ?? '').trim(), text: String(f.get('text') ?? '').trim() }, '行', rerender)
  })
  within(view, '#daily-copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(daily.text)
      toast('文をコピーしました', 2000)
    } catch {
      toast('コピーできませんでした。下の文を選んでコピーしてください')
    }
  })
}
