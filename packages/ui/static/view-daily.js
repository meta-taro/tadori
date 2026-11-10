// 1 日の進行：担当ごとに見て、その場で直す（プロダクト単位の残課題とは別に、人単位で見る）。
// 材料（WBS の状態の変化・台帳の差分・チェックの記録）から作った下書きを、日ごとのファイルに置き、行を足す・直す・消す。
// 直した行・足した行・消した行は、下書きを作り直しても上書きしない。
import { t } from './i18n.js'
import { api, esc, getWho, ICON_INFO, messageOf, nthIndexOf, toast, toastCommit, webUrl, within } from './util.js'
import { previewHtml } from './daily-preview.js'

/** @typedef {import('./types').DailyEntry} DailyEntry */
/** @typedef {import('./types').Origin} Origin */
/** @typedef {Readonly<Record<string, Origin>>} Origins 行 ID → 正本へのリンクと反映の記録 */

// 担当は上の帯で選ぶ（どの画面も同じ）
let date = ''

// 台帳の整備（台帳の行を足した・直した）は、成果物の作業と読み違えないよう別の見出しにする。無い日は出さない
/** @type {Array<[string, string]>} */
const SECTIONS = [['today', 'Today'], ['next', 'Next working day'], ['consult', 'Questions'], ['upkeep', 'Ledger upkeep']]
/** @type {Readonly<Record<string, string>>} */
const ORIGIN_LABEL = { edited: 'Edited', manual: 'Added' }
// 行の印（やり終えたことか、これからのことか）。文に出す言葉は案件の設定で決まる。画面の選択肢は意味で示す
/** @type {Array<[string, string]>} */
const TAGS = [['', 'No tag'], ['done', 'Done'], ['doing', 'In progress'], ['plan', 'Planned'], ['upkeep', 'Ledger upkeep'], ['checked', 'Checked']]
const tagSelect = (/** @type {DailyEntry} */ entry) => `<select class="inline-select daily-tag" data-tag="${esc(entry.id)}" aria-label="${esc(t('Tag'))}">${TAGS.map(([v, l]) => `<option value="${v}" ${v === (entry.tag ?? '') ? 'selected' : ''}>${esc(t(l))}</option>`).join('')}</select>`

/**
 * 外のページを新しいタブ（デスクトップアプリでは OS のブラウザ）で開くリンク。URL は文字に出さない
 * @param {string} label
 * @param {string} url
 * @param {string} title
 * @param {string} [extra]
 */
const outLink = (label, url, title, extra = '') => `<a class="daily-link ${extra}" href="${esc(url)}" target="_blank" rel="noopener noreferrer" data-external title="${esc(title)}">${esc(label)} ↗</a>`

/** その作業でさわった正本の場所（エージェントや人が links で付けたもの） */
// 本文の語（anchor）が見つかるリンクは、文の形でその語をリンクにするので、行末には出さない（見つからなければ行末に出す）
const entryLinks = (/** @type {DailyEntry} */ entry) => (entry.links ?? [])
  .filter(l => !l.anchor || nthIndexOf(entry.text, l.anchor, l.nth ?? 1) < 0)
  .flatMap(l => (webUrl(l.url) ? [outLink(l.label, webUrl(l.url), t('Open {label}: {url}', { label: l.label, url: l.url }))] : [])).join('')

/**
 * 課題の正本へ飛ぶ小さなリンク（会議の場で正本を開けるように）。表示名は正本の表の名前。反映が古ければ目立たせる
 * @param {Origin | undefined} origin
 */
function originLink(origin) {
  const url = webUrl(origin?.url)
  if (!origin || !url) return ''
  const sync = origin.syncedAt ? `${t('Synced')} ${origin.syncedAt}${origin.syncedBy ? ` ${origin.syncedBy}` : ''}` : t('Never synced')
  return outLink(origin.name || t('Source'), url, t('Open the source of truth ({sync}): {url}', { sync: `${sync}${origin.stale ? ` · ${t('stale')}` : ''}`, url }), `origin-link ${origin.stale ? 'stale' : ''}`)
}

/**
 * 1 行：番号・本文（その場で直せる）・担当・課題と WBS へのリンク・消すボタン
 * @param {DailyEntry} entry
 * @param {number} no
 * @param {Origins} [origins]
 * @param {boolean} [isAll]
 */
function entryRow(entry, no, origins = {}, isAll = true) {
  const badge = ORIGIN_LABEL[entry.origin] ? `<span class="chip mono">${esc(t(ORIGIN_LABEL[entry.origin] ?? ''))}</span>` : ''
  // 課題は「つながりを辿る」へ、WBS は「プロダクト」のその行へ（会議の場で、その場から開けるように）
  const issue = entry.issue ? `<a class="cond mono" href="#trace-${encodeURIComponent(entry.issue)}" title="${esc(t('Trace from {id}', { id: entry.issue }))}">${esc(entry.issue)}</a>` : ''
  const wbs = entry.wbs.map(id => `<a class="cond mono" href="#browse-${encodeURIComponent(id)}" title="${esc(t('Open {id} in the WBS', { id }))}">${esc(id)}</a>`).join('')
  const origin = originLink(entry.issue ? origins[entry.issue] : undefined)
  // 行のバッジ（人かエージェントが書いた札）。本文とは別に、tone の色で出す
  const badges = (entry.badges ?? []).map(b => `<span class="chip ${esc(b.tone)}"><span class="dot"></span>${esc(b.text)}</span>`).join('')
  return `<li class="daily-entry">
    <span class="daily-no">${no}.</span>
    ${tagSelect(entry)}
    ${isAll ? `<span class="daily-who" title="${esc(t('Owner of this row'))}">${esc(entry.who || t('No owner'))}</span>` : ''}
    <input class="inline-input daily-text" data-entry="${esc(entry.id)}" value="${esc(entry.text)}" aria-label="${esc(t('Text of row {n}', { n: no }))}" maxlength="500">
    <span class="daily-badges">${badges}</span>
    <span class="daily-links">${origin}${entryLinks(entry)}</span>
    <span class="daily-meta">${badge}${issue}${wbs}</span>
    <button type="button" class="btn-ghost" data-remove="${esc(entry.id)}" aria-label="${esc(t('Remove row {n}', { n: no }))}">${esc(t('Remove'))}</button>
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
  const scope = `<span class="chip daily-scope">${isAll ? esc(t('Everyone')) : esc(who)}</span>`
  let no = 0
  return SECTIONS.map(([id, label]) => {
    const list = entries.filter(e => e.section === id)
    if (id === 'upkeep' && !list.length) return ''
    const rows = list.map(e => entryRow(e, ++no, origins, isAll)).join('')
    return `<section class="daily-section"><h2>${esc(t(label))}${id === 'today' ? ` ${esc(t('{n} items', { n: list.length }))}` : ''}${scope}</h2>
      ${rows ? `<ol class="daily-list">${rows}</ol>` : `<p class="cond">${esc(id === 'consult' ? t('Add one with the form below') : t('Nothing'))}</p>`}</section>`
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
    toast(t('Could not save {what}: {error}', { what, error: messageOf(error) }))
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
    view.innerHTML = `<h1>${esc(t('Daily progress'))}</h1><div class="note">${ICON_INFO}<span>${esc(messageOf(error))}</span></div>`
    return
  }
  const base = `/api/daily/${encodeURIComponent(date)}`
  view.innerHTML = `
    <h1>${esc(t('Daily progress'))}</h1>
    <p class="lede">${daily.intro ? esc(daily.intro) : esc(t('Daily progress per person. The draft is built from WBS status changes, ledger changes and the check log. Edit the text in place; edited, added and removed rows stay even when the draft is rebuilt.'))}</p>
    <div class="daily-bar">
      <label class="cond">${esc(t('Date'))} <input id="daily-date" class="inline-input" type="date" value="${esc(date)}"></label>
      <button type="button" class="btn-primary" id="daily-generate">${esc(daily.saved ? t('Rebuild the draft') : t('Build the draft'))}</button>
      <button type="button" class="btn-ghost" id="daily-copy">${esc(t('Copy text'))}</button>
    </div>
    ${daily.saved ? '' : `<div class="note">${ICON_INFO}<span>${esc(t('This draft is not saved to the daily file yet. It is saved as soon as you edit or add a row.'))}</span></div>`}
    <div class="panel daily-sheet">
      ${sectionsHtml(daily.entries, state.origins ?? {})}
      <form class="add" id="daily-add">
        <label>${esc(t('Section'))}<select name="section">${SECTIONS.map(([id, label]) => `<option value="${id}" ${id === 'consult' ? 'selected' : ''}>${esc(t(label))}</option>`).join('')}</select></label>
        <label>${esc(t('Owner'))}<input name="who" value="${esc(getWho())}" maxlength="100"></label>
        <label class="grow">${esc(t('Text'))}<input name="text" required maxlength="500" placeholder="${esc(t('e.g. Ask when the test environment will be free'))}"></label>
        <div class="actions"><button type="submit" class="btn-primary">${esc(t('Add'))}</button></div>
      </form>
    </div>
    <h2>${esc(t('Text (with notes)'))}</h2>
    <div class="panel daily-preview">${previewHtml(daily.text, daily.links ?? [], daily.tags ?? [], daily.whoMarks ?? [], daily.entries ?? [])}</div>`

  const dateInput = /** @type {HTMLInputElement} */ (within(view, '#daily-date'))
  dateInput.addEventListener('change', () => { if (dateInput.value) { date = dateInput.value; rerender() } })
  within(view, '#daily-generate').addEventListener('click', () => write(`${base}/generate`, 'POST', {}, t('the daily draft'), rerender))
  const entryInputs = /** @type {NodeListOf<HTMLInputElement>} */ (view.querySelectorAll('[data-entry]'))
  entryInputs.forEach(input => input.addEventListener('change', () =>
    write(`${base}/entries/${encodeURIComponent(input.dataset.entry ?? '')}`, 'PUT', { text: input.value }, t('the row'), rerender)))
  const tagSelects = /** @type {NodeListOf<HTMLSelectElement>} */ (view.querySelectorAll('[data-tag]'))
  tagSelects.forEach(select => select.addEventListener('change', () =>
    write(`${base}/entries/${encodeURIComponent(select.dataset.tag ?? '')}`, 'PUT', { tag: select.value }, t('the tag'), rerender)))
  const removeButtons = /** @type {NodeListOf<HTMLButtonElement>} */ (view.querySelectorAll('[data-remove]'))
  removeButtons.forEach(button => button.addEventListener('click', () =>
    write(`${base}/entries/${encodeURIComponent(button.dataset.remove ?? '')}`, 'DELETE', {}, t('the removal'), rerender)))
  const addForm = /** @type {HTMLFormElement} */ (within(view, '#daily-add'))
  addForm.addEventListener('submit', e => {
    e.preventDefault()
    const f = new FormData(addForm)
    write(`${base}/entries`, 'POST', { section: f.get('section'), who: String(f.get('who') ?? '').trim(), text: String(f.get('text') ?? '').trim() }, t('the row'), rerender)
  })
  within(view, '#daily-copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(daily.text)
      toast(t('Copied the text'), 2000)
    } catch {
      toast(t('Could not copy. Select the text below and copy it.'))
    }
  })
}
