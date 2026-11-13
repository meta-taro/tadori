// 1 日の進行：担当ごとに見て、その場で直す（プロダクト単位の残課題とは別に、人単位で見る）。
// 材料（WBS の状態の変化・台帳の差分・チェックの記録）から作った下書きを、日ごとのファイルに置き、行を足す・直す・消す。
// 直した行・足した行・消した行は、下書きを作り直しても上書きしない。
import { t } from './i18n.js'
import { api, esc, getWho, ICON_INFO, messageOf, nthIndexOf, toast, toastCommit, webUrl, within, idPill } from './util.js'
import { previewHtml } from './daily-preview.js'

/** @typedef {import('./types').DailyEntry} DailyEntry */
/** @typedef {import('./types').Origin} Origin */
/** @typedef {Readonly<Record<string, Origin>>} Origins 行 ID → 正本へのリンクと反映の記録 */

// 担当は上の帯で選ぶ（どの画面も同じ）
let date = ''

// 台帳の整備（台帳の行を足した・直した）は、成果物の作業と読み違えないよう別の見出しにする。無い日は出さない
/** @type {Array<[string, string]>} */
const SECTIONS = [['today', 'Today'], ['next', 'Next working day'], ['consult', 'Questions'], ['upkeep', 'Ledger upkeep']]

/** 読み上げ（課題ごとの要約だけ）か、詳しく（今までどおりの細かい行）か。夕会で読む・聞かれたら引く、を切り替える */
let readMode = false

/** 古いままの待ちの行（server が案件の stale_hours・wait_words で選んだもの）の ID と、何時間で古いとするか */
let stale = { ids: /** @type {Set<string>} */ (new Set()), hours: 0 }

/**
 * 行を最後に直した時刻（その日なら時刻だけ、別の日なら月日も）。自動の行など、時刻の無い行は出さない
 * @param {string | undefined} updated
 */
function updatedText(updated) {
  if (!updated) return ''
  const time = updated.startsWith(date) ? updated.slice(11) : `${Number(updated.slice(5, 7))}/${Number(updated.slice(8, 10))} ${updated.slice(11)}`
  return t('Updated {time}', { time })
}

/**
 * 読み上げ：要約のある課題は、今日の細かい行の代わりに要約を今日の先頭に出す（server の readAloud と同じ決まり）
 * @param {readonly DailyEntry[]} entries
 */
function readAloud(entries) {
  const summaries = entries.filter(e => e.section === 'summary' && e.issue)
  const summarized = new Set(summaries.map(e => e.issue))
  const rest = entries.filter(e => e.section !== 'summary' && !(e.section === 'today' && e.issue && summarized.has(e.issue)))
  return [...summaries.map(e => ({ ...e, section: /** @type {const} */ ('today') })), ...rest]
}
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
 * @param {boolean} [isSummary] 課題ごとの要約の行（読み上げでは今日の欄に入っても、折り返して全文を見せる）
 */
function entryRow(entry, no, origins = {}, isAll = true, isSummary = entry.section === 'summary') {
  const badge = ORIGIN_LABEL[entry.origin] ? `<span class="chip mono">${esc(t(ORIGIN_LABEL[entry.origin] ?? ''))}</span>` : ''
  // 課題は「つながりを辿る」へ、WBS は「プロダクト」のその行へ（会議の場で、その場から開けるように）
  const issue = entry.issue ? `<a class="cond mono" href="#trace-${encodeURIComponent(entry.issue)}" title="${esc(t('Trace from {id}', { id: entry.issue }))}">${esc(entry.issue)}</a>` : ''
  const wbs = entry.wbs.map(id => idPill(id, `#browse-${encodeURIComponent(id)}`, t('Open {id} in the WBS', { id }))).join('')
  const origin = originLink(entry.issue ? origins[entry.issue] : undefined)
  // 行のバッジ（人かエージェントが書いた札）。本文とは別に、tone の色で出す
  const badges = (entry.badges ?? []).map(b => `<span class="chip ${esc(b.tone)}"><span class="dot"></span>${esc(b.text)}</span>`).join('')
  // 古いままの待ちの行は、会の前に直す行と一目で分かるよう、要注意の札と枠で出す
  const isStale = stale.ids.has(entry.id)
  const staleChip = isStale ? `<span class="chip hole daily-stale"><span class="dot"></span>${esc(t('Not updated for {hours}h+', { hours: stale.hours }))}</span>` : ''
  const updated = updatedText(entry.updated)
  return `<li class="daily-entry${isStale ? ' stale' : ''}">
    <span class="daily-no">${no}.</span>
    ${tagSelect(entry)}
    ${isAll ? `<span class="daily-who" title="${esc(t('Owner of this row'))}">${esc(entry.who || t('No owner'))}</span>` : ''}
    ${isSummary
      // 要約は長くなりやすいので、折り返して全文を見せる（読み上げる文なので、途中で切らない）
      ? `<textarea class="inline-input daily-text daily-summary-text" data-entry="${esc(entry.id)}" rows="${Math.min(4, Math.max(2, Math.ceil(entry.text.length / 45)))}" aria-label="${esc(t('Text of row {n}', { n: no }))}" maxlength="500">${esc(entry.text)}</textarea>`
      : `<input class="inline-input daily-text" data-entry="${esc(entry.id)}" value="${esc(entry.text)}" aria-label="${esc(t('Text of row {n}', { n: no }))}" maxlength="500">`}
    <span class="daily-badges">${badges}${staleChip}</span>
    ${updated ? `<span class="daily-updated cond mono" title="${esc(t('When this row was last added or edited'))}">${esc(updated)}</span>` : ''}
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
  const shown = readMode ? readAloud(entries) : entries
  const summaryIds = new Set(entries.filter(e => e.section === 'summary').map(e => e.id))
  // 詳しくのときは、課題ごとの要約を今日の上にまとめて出す（読み上げのときは今日の欄の先頭に入る）
  const sections = readMode ? SECTIONS : [['summary', 'Summaries per issue'], ...SECTIONS]
  return sections.map(([id, label]) => {
    const list = shown.filter(e => e.section === id)
    if ((id === 'upkeep' || id === 'summary') && !list.length) return ''
    const rows = list.map(e => entryRow(e, ++no, origins, isAll, summaryIds.has(e.id))).join('')
    return `<section class="daily-section" data-section="${esc(id)}"><h2>${esc(t(label))}${id === 'today' ? ` ${esc(t('{n} items', { n: list.length }))}` : ''}${scope}</h2>
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
    daily = await api(`/api/daily?date=${encodeURIComponent(date)}${who ? `&who=${encodeURIComponent(who)}` : ''}${readMode ? '&read=1' : ''}`)
  } catch (error) {
    view.innerHTML = `<h1>${esc(t('Daily progress'))}</h1><div class="note">${ICON_INFO}<span>${esc(messageOf(error))}</span></div>`
    return
  }
  stale = { ids: new Set(daily.stale?.ids ?? []), hours: daily.stale?.hours ?? 0 }
  const base = `/api/daily/${encodeURIComponent(date)}`
  view.innerHTML = `
    <h1>${esc(t('Daily progress'))}</h1>
    <p class="lede">${daily.intro ? esc(daily.intro) : esc(t('Daily progress per person. The draft is built from WBS status changes, ledger changes and the check log. Edit the text in place; edited, added and removed rows stay even when the draft is rebuilt.'))}</p>
    <div class="daily-bar">
      <label class="cond">${esc(t('Date'))} <input id="daily-date" class="inline-input" type="date" value="${esc(date)}"></label>
      <button type="button" class="btn-primary" id="daily-generate">${esc(daily.saved ? t('Rebuild the draft') : t('Build the draft'))}</button>
      <button type="button" class="btn-ghost" id="daily-copy">${esc(t('Copy text'))}</button>
      <div class="seg" role="group" aria-label="${esc(t('How to show'))}">
        <button type="button" data-read="1" aria-pressed="${readMode}" class="${readMode ? 'on' : ''}" title="${esc(t('Show only the summary for issues that have one'))}">${esc(t('Read out'))}</button>
        <button type="button" data-read="0" aria-pressed="${!readMode}" class="${readMode ? '' : 'on'}">${esc(t('Details'))}</button>
      </div>
    </div>
    ${stale.ids.size ? `<div class="note daily-stale-note" role="status">${ICON_INFO}<span>${esc(t('{n} waiting rows have not been updated for {hours} hours or more. Update them before the meeting.', { n: stale.ids.size, hours: stale.hours }))}</span></div>` : ''}
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
  view.querySelectorAll('[data-read]').forEach(button => button.addEventListener('click', () => {
    readMode = /** @type {HTMLElement} */ (button).dataset.read === '1'
    rerender()
  }))
  within(view, '#daily-generate').addEventListener('click', () => write(`${base}/generate`, 'POST', {}, t('the daily draft'), rerender))
  const entryInputs = /** @type {NodeListOf<HTMLInputElement | HTMLTextAreaElement>} */ (view.querySelectorAll('[data-entry]'))
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
