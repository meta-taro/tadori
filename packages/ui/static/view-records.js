// チェックの記録・つながりを辿る
import { t } from './i18n.js'
import { api, chip, esc, ICON_INFO, idPill, kindLabel, messageOf, originHtml, toast, within, ICON_LINK, personChips } from './util.js'
import { renderPicker } from './trace-picker.js'
import { renderCheckpoints } from './view-checkpoints.js'

/** @typedef {import('./types').ProjectState} ProjectState */
/** @typedef {import('./types').TraceResult} TraceResult */
/** @typedef {import('./types').ResolvedItem} ResolvedItem */

const RESULT_TONE = (/** @type {string} */ result) => (/^(漏れ|差し戻し|Gaps:|sent back|rejected)/i.test(result) ? 'hole' : /^(満たす|承認|Met|approved)/i.test(result) ? 'ok' : '')

/**
 * 結果を、見出しにする要約と、そのうしろの中身（漏れの行の並びなど）に分ける。
 * 例：「漏れ 2 件（DD-2.3・DD-3.2）」→ 見出し「漏れ 2 件」・中身「DD-2.3・DD-3.2」
 * @param {string} result
 */
function splitResult(result) {
  const match = /^(.*?)\s*[（(](.*)[）)]\s*$/.exec(result)
  return match ? { head: match[1] || result, detail: match[2] ?? '' } : { head: result, detail: '' }
}

/**
 * 長い文は切り、押すと全部出す（見出しと要約だけで一覧として流し読みできるように）
 * @param {string} text
 * @param {string} label
 */
const clamp = (text, label) => (text
  ? `<button type="button" class="log-clamp" aria-expanded="false" title="${esc(t('Show all'))}" aria-label="${esc(label)}">${esc(text)}</button>`
  : '')

/**
 * 結果の中身。行の ID の並び（「A・B」「A, B」）なら ID の札にし、多ければ切って押すと全部出す。それ以外の文はそのまま切る
 * @param {string} detail
 */
function detailHtml(detail) {
  const ids = detail.split(/[・,、]\s*/).map(v => v.trim()).filter(Boolean)
  const isIdList = ids.length > 0 && ids.every(id => /^[A-Za-z][\w.-]*$/.test(id))
  if (!isIdList) return clamp(detail, t('Rows: {rows}', { rows: detail }))
  return `<button type="button" class="log-clamp log-ids" aria-expanded="false" aria-label="${esc(t('Rows: {rows}', { rows: detail }))}">${ids.map(id => idPill(id)).join('')}</button>`
}

/** @typedef {ProjectState['checks'][number]} CheckRecord */

/**
 * 記録の「どこで」を、読む人に意味のある形にする。
 * 前の版は、立ち上げた場所から案件までの相対（..\..\案件）や「.」を書いていた。案件そのものを指すものは出さない
 * @param {string} where
 */
function placeOf(where) {
  const value = (where ?? '').trim()
  if (!value || value === '.' || /^\.\.([\\/]|$)/.test(value) || /^([A-Za-z]:)?[\\/]/.test(value)) return ''
  return value
}

/** 結果の文から漏れの件数を読む（「漏れ 2 件（…）」「Gaps: 2 (…)」）。漏れの記録でなければ 0 @param {string} result */
const gapCount = result => Number(/^(?:漏れ|Gaps:)\s*(\d+)/i.exec(result)?.[1] ?? 0)

/**
 * 1 回のチェック：時刻・だれ・なぜが同じ記録をまとめたもの（tadori check はルールごとに 1 行を書く）
 * @param {readonly CheckRecord[]} records 新しいものが上の並び
 * @returns {CheckRecord[][]}
 */
function runsOf(records) {
  /** @type {CheckRecord[][]} */
  const runs = []
  for (const r of records) {
    const last = runs.at(-1)?.[0]
    if (last && last.when === r.when && last.who === r.who && last.why === r.why) runs.at(-1)?.push(r)
    else runs.push([r])
  }
  return runs
}

/** 1 つのルールの記録の行（結果の札・ルール・漏れの行の札） @param {CheckRecord} r */
function ruleLine(r) {
  const { head, detail } = splitResult(r.result)
  return `<div class="log-rule">${chip(RESULT_TONE(r.result), esc(head))}<span class="log-rule-what">${esc(r.what)}</span>${detail ? detailHtml(detail) : ''}</div>`
}

/**
 * チェックの記録 1 回分：見出し（全体の要約）・中身（ルールごとの行。満たすルールは畳む）・下に小さく いつ・だれが・なぜ
 * @param {readonly CheckRecord[]} run
 */
function logEntry(run) {
  const first = /** @type {CheckRecord} */ (run[0])
  const gaps = run.reduce((n, r) => n + gapCount(r.result), 0)
  // 1 回の中のルールは ID の順（新しいものが上の並びを、ここでは戻す）
  const byRule = [...run].sort((a, b) => a.what.localeCompare(b.what, 'ja', { numeric: true }))
  const met = byRule.filter(r => RESULT_TONE(r.result) === 'ok')
  const open = byRule.filter(r => RESULT_TONE(r.result) !== 'ok')
  // 見出し：漏れの合計と、満たすルールの数（人の承認の記録など 1 件だけのときは、その結果）
  const heads = run.length === 1
    ? [chip(RESULT_TONE(first.result), esc(splitResult(first.result).head))]
    : [gaps ? chip('hole', esc(t('Gaps: {n}', { n: gaps }))) : '', met.length ? chip('ok', esc(t('Met: {n} rules', { n: met.length }))) : '']
  const title = run.length === 1 ? first.what : t('{n} rules checked', { n: run.length })
  const tone = gaps || open.some(r => RESULT_TONE(r.result) === 'hole') ? 'hole' : met.length === run.length ? 'ok' : 'none'
  const place = [...new Set(run.map(r => placeOf(r.where)).filter(Boolean))]
  const how = [...new Set(run.map(r => r.how).filter(Boolean))]
  const where = [...place, ...how].map(v => `<span class="mono">${esc(v)}</span>`).join('<span class="log-sep">·</span>')
  const rules = run.length === 1
    ? (splitResult(first.result).detail ? detailHtml(splitResult(first.result).detail) : '')
    : `${open.map(ruleLine).join('')}${met.length ? `<details class="log-met"><summary>${esc(t('Met: {n} rules', { n: met.length }))}</summary>${met.map(ruleLine).join('')}</details>` : ''}`
  const why = first.why ? `<span class="log-sep">·</span>${clamp(first.why, t('Why: {why}', { why: first.why }))}` : ''
  return `<article class="log-entry ${tone}">
    <header class="log-head">${heads.join('')}<span class="log-what">${esc(title)}</span></header>
    ${where || rules ? `<div class="log-body">${where ? `<div class="log-where">${where}</div>` : ''}${rules}</div>` : ''}
    <footer class="log-meta"><span class="mono">${esc(first.when)}</span>${personChips(first.who)}${why}</footer>
  </article>`
}

/**
 * @param {HTMLElement} view
 * @param {ProjectState} state
 */
export function renderLog(view, state) {
  // 新しいものが上
  const entries = runsOf([...state.checks].reverse()).map(logEntry).join('')
  view.innerHTML = `
    <h1>${esc(t('Check log'))}</h1>
    <section class="cp-section"></section>
    <h2>${esc(t('Gap checks (tadori check)'))}</h2>
    <p class="lede">${esc(t('Each time the rules are checked, one row is added in 5W1H form ({file}, managed in git). People write the rows for their own approvals.')).replace('{file}', () => '<span class="mono">.tadori/checks.tsv</span>')}</p>
    <div class="note">${ICON_INFO}<span>${esc(t('To add a row, use {command}.')).replace('{command}', () => `<span class="mono">${esc(t('tadori check --log --who NAME --why REASON'))}</span>`)}</span></div>
    <div class="log-list">${entries || `<p class="cond">${esc(t('No records yet'))}</p>`}</div>`
  renderCheckpoints(/** @type {HTMLElement} */ (view.querySelector('.cp-section')), state)
  // 切った文は、押すと全部出る（もう一度押すと戻る）
  view.querySelectorAll('.log-clamp').forEach(el => el.addEventListener('click', () => {
    el.setAttribute('aria-expanded', String(el.getAttribute('aria-expanded') !== 'true'))
  }))
}

const ICON_OK = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><path d="M3.5 8.5l3 3 6-7"/></svg>'
const ICON_NG = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4l8 8M12 4l-8 8"/></svg>'

/**
 * @param {TraceResult} result
 * @param {readonly ResolvedItem[]} [resolved]
 * @param {ProjectState['origins']} [origins]
 */
function storyPath(result, resolved = [], origins = {}) {
  // 切れ目として出す漏れは、カードに重ねて出さない（列が空など、つながり以外の漏れだけをカードに出す）
  const shownAsGap = new Set(result.steps.flatMap(s => (s.type === 'missing' ? [`${s.rule}:${s.after ?? s.before}`] : [])))
  /** @type {string[]} */
  const parts = []
  result.steps.forEach((s, i) => {
    const prev = result.steps[i - 1]
    // 切れ目の前後の線を赤くする（上流が無い切れ目は、その後ろの線、下流が無い切れ目は前の線）
    const broken = s.type === 'missing' || prev?.type === 'missing'
    if (i > 0) parts.push(`<div class="sp-link ${broken ? 'broken' : ''}"><span class="sp-line"></span><span class="sp-link-label">${s.type === 'missing' ? esc(t('Broken here')) : ''}</span></div>`)
    if (s.type === 'missing') {
      const what = s.before ? t('The {kind} it is based on is missing', { kind: kindLabel(s.kind) }) : t('{kind} is missing', { kind: kindLabel(s.kind) })
      parts.push(`<div class="sp-card ng"><div class="sp-phase"><span class="leak-id">${esc(s.rule)}·${esc(s.after ?? s.before)}</span></div><div class="sp-icon">${ICON_NG}</div>
        <div class="sp-kind">${esc(kindLabel(s.kind))}</div><div class="sp-say">${esc(what)}</div><div class="sp-src">${esc(t('No {kind} row in the ledger', { kind: s.kind }))}</div></div>`)
      return
    }
    const isStart = s.item.id === result.start.id
    const other = (s.leaks ?? []).filter(l => !shownAsGap.has(`${l.rule}:${l.itemId}`))
    const leakHtml = other.map(l => `<div class="sp-leak">${esc(t('Gap {id}: {message}')).replace('{id}', () => `<b>${esc(l.rule)}·${esc(l.itemId)}</b>`).replace('{message}', () => esc(l.message))}</div>`).join('')
    // 前のチェックでは漏れだったが、いまは満たす行（チェックの記録から読む）
    const was = resolved.find(r => r.itemId === s.item.id)
    // カードは 3 つ：いまも漏れ（ng）／前は漏れで、いまは満たす（resolved）／初めから漏れなし（ok）
    // 漏れが切れ目として出ている行も、その行自身の漏れなので「漏れ」にする（中身は切れ目のカードに書く）
    const card = (s.leaks ?? []).length ? 'ng' : was ? 'resolved' : 'ok'
    const resolvedHtml = card === 'resolved' && was ? `<div class="sp-resolved">${esc(t('Gap at the {date} check ({rule}) → met now', { date: was.when.slice(5, 10).replace('-', '/'), rule: was.rule }))}</div>` : ''
    const badge = { ng: `<span class="sp-badge ng">${esc(t('Gap'))}</span>`, resolved: `<span class="sp-badge resolved">${esc(t('Resolved'))}</span>`, ok: `<span class="sp-badge ok">${esc(t('No gaps'))}</span>` }[card]
    const icon = { ng: ICON_NG, resolved: `<span class="sp-flip">${ICON_NG}<span>→</span>${ICON_OK}</span>`, ok: ICON_OK }[card]
    parts.push(`<div class="sp-card ${card === 'ng' && !other.length ? 'ng-gap' : card} ${isStart ? 'end' : ''}"><div class="sp-phase">${isStart ? esc(t('Starting point')) : ''}${badge}</div><div class="sp-icon">${icon}</div>
      <div class="sp-kind">${esc(kindLabel(s.item.kind))} <span class="mono">${esc(s.item.id)}</span></div>
      <div class="sp-say">${esc(s.item.title)}</div>${leakHtml}${resolvedHtml}<div class="sp-src">${origins[s.item.id] ? originHtml(origins[s.item.id]) : esc(s.item.source)}</div></div>`)
  })
  return parts.join('')
}

/**
 * 図の上の 1 行：この線の上の漏れと対応済みが、どの行のものかを並べる
 * @param {TraceResult} result
 * @param {readonly ResolvedItem[]} resolved
 */
function traceSummary(result, resolved) {
  /** @type {Set<string | undefined>} */
  const leakIds = new Set()
  for (const s of result.steps) {
    if (s.type === 'missing') leakIds.add(s.after ?? s.before)
    else if ((s.leaks ?? []).length) leakIds.add(s.item.id)
  }
  const onLine = new Set(result.steps.flatMap(s => (s.type === 'item' ? [s.item.id] : [])))
  const done = resolved.filter(r => onLine.has(r.itemId) && !leakIds.has(r.itemId)).map(r => r.itemId)
  const parts = [
    leakIds.size ? `<span class="chip hole"><span class="dot"></span>${esc(t('Gaps: {n} ({ids})', { n: leakIds.size, ids: [...leakIds].join(t(', ')) }))}</span>` : `<span class="chip ok"><span class="dot"></span>${esc(t('No gaps on this line'))}</span>`,
    done.length ? `<span class="chip ok"><span class="dot"></span>${esc(t('Resolved: {n} ({ids})', { n: done.length, ids: done.join(t(', ')) }))}</span>` : '',
  ]
  return `<div class="trace-summary"><span class="cond">${esc(t('On this line:'))}</span>${parts.join('')}</div>`
}

/**
 * @param {HTMLElement} view
 * @param {ProjectState} state
 * @param {string} startId
 */
export async function renderTrace(view, state, startId) {
  const start = state.items.find(i => i.id === startId)
  view.innerHTML = `
    <h1>${esc(t('Trace'))}</h1>
    <p class="lede">${esc(t('Starting from one ledger row (a finding, a test case, a design section and so on), shows its upstream and downstream links in phase order. tadori decides links only from the IDs written in the ledger and never guesses. Broken links are red.'))}</p>
    <div class="trace-layout">
      <section aria-label="${esc(t('Where to start'))}"><h2>${esc(t('Where to start'))}</h2><div id="picker"></div></section>
      <section aria-label="${esc(t('Trace result'))}">
        <div class="trace-head"><h2>${start ? esc(t('Traced from {id} “{title}”', { title: start.title })).replace('{id}', () => `<span class="big-id">${esc(start.id)}</span>`) : esc(t('Trace result'))}</h2>${start ? `<button type="button" class="btn-ghost" id="copy-link" title="${esc(t('A link that opens this result (to share in a meeting)'))}">${ICON_LINK}<span>${esc(t('Copy link'))}</span></button>` : ''}</div>
        <div id="trace-summary"></div>
        <div class="story-path" id="story" role="list"><div class="cond">${esc(startId ? t('Loading…') : t('Choose the row to start from on the left'))}</div></div>
        <div class="verdict"><span>${esc(t('A person decides where on this line the gap was. Once you have checked, record it in the check log as a human row.'))}</span></div>
      </section>
    </div>`
  renderPicker(within(view, '#picker'), state, startId, id => { location.hash = `trace-${encodeURIComponent(id)}` })
  if (!startId) return
  // リンクをコピー：クリックの中でだけ書き込める。断られたら URL を知らせる
  view.querySelector('#copy-link')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(location.href)
      toast(t('Copied the link: {url}', { url: location.href }))
    } catch {
      toast(t('Could not copy. Share the URL in the address bar: {url}', { url: location.href }))
    }
  })
  try {
    /** @type {TraceResult} */
    const result = await api(`/api/trace/${encodeURIComponent(startId)}`)
    within(view, '#story').innerHTML = storyPath(result, state.resolved ?? [], state.origins ?? {})
    within(view, '#trace-summary').innerHTML = traceSummary(result, state.resolved ?? [])
  } catch (error) {
    within(view, '#story').innerHTML = `<div class="note">${ICON_INFO}<span>${esc(messageOf(error))}</span></div>`
  }
}
