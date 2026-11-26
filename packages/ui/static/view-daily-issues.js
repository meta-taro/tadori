// 1 日の進行を「課題ごと」に並べる。1 つの案件で課題が何本も並行するときに、課題ごとの今の状態をひと目で読むため。
// 行の中身は人ごとの並びと同じ（直す・消す・印を変えるも同じ口）。並べ方だけを変える
import { t } from './i18n.js'
import { esc, webUrl } from './util.js'

/** @typedef {import('./types').DailyEntry} DailyEntry */

/** 課題ごとの中で並べる欄（要約は見出しの「今」に出すので、ここには入れない） */
const PARTS = /** @type {const} */ ([['today', 'Today'], ['next', 'Next working day'], ['consult', 'Questions'], ['upkeep', 'Ledger upkeep']])

/**
 * @typedef {object} IssueContext
 * @property {(entry: DailyEntry, no: number) => string} row 1 行を描く（人ごとの並びと同じ行）
 * @property {readonly import('./types').Item[]} items 台帳の行（課題の短い名前）
 * @property {readonly import('./types').Task[]} tasks WBS の作業（課題の工程の位置）
 * @property {readonly import('./types').StatusDef[]} statuses 状態の名前
 * @property {Readonly<Record<string, { label: string, url: string }>>} issueLinks 課題の正本の WBS の行
 * @property {(tag: string) => string} tagWord 行の印の言葉（作業中・待ち など）
 */

/**
 * 課題の「今」の 1 行：課題ごとの要約があればそれ、無ければいちばん新しく直した行（直した時刻が無ければ最後の行）
 * @param {readonly DailyEntry[]} rows
 * @returns {DailyEntry | undefined}
 */
export function latestOf(rows) {
  const summary = rows.find(e => e.section === 'summary')
  if (summary) return summary
  const work = rows.filter(e => e.section !== 'upkeep')
  // 直した時刻は分までなので、同じ時刻なら後ろ（あとから足した・直した）行を選ぶ
  const newest = work.reduce((/** @type {DailyEntry | undefined} */ best, e) => (e.updated && (!best?.updated || e.updated >= best.updated) ? e : best), undefined)
  return newest ?? work.at(-1)
}

/**
 * 課題ごとの見出し：課題番号・短い名前・正本の WBS・工程の位置・今の 1 行
 * @param {string} id
 * @param {readonly DailyEntry[]} rows
 * @param {IssueContext} ctx
 */
function headHtml(id, rows, ctx) {
  const item = ctx.items.find(i => i.id === id)
  const name = item ? (item.fields.short || item.title) : ''
  const link = ctx.issueLinks[id]
  const url = webUrl(link?.url)
  const source = url ? `<a class="daily-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer" data-external title="${esc(url)}">${esc(link?.label ?? 'WBS')} ↗</a>` : ''
  // 工程の位置：この課題の WBS の作業と、その状態
  const steps = ctx.tasks.filter(task => task.issue === id).map(task => {
    const status = ctx.statuses.find(s => s.id === task.status)
    return `<span class="chip ${esc(status?.tone ?? 'none')}" title="${esc(task.id)}"><span class="dot"></span>${esc(task.name)} ${esc(status?.name ?? task.status)}</span>`
  }).join('')
  const latest = latestOf(rows)
  const word = latest?.tag ? ctx.tagWord(latest.tag) : ''
  // 行の頭の「課題番号 短い名前」は見出しにあるので、今の 1 行では外す
  const head = [`${id} ${name} `, `${id} `].find(prefix => latest?.text.startsWith(prefix))
  const text = latest ? latest.text.slice(head?.length ?? 0) : ''
  const now = latest ? `<p class="issue-now"><span class="cond">${esc(t('Now'))}</span> ${word ? `<span class="daily-pill">${esc(word)}</span>` : ''}${esc(text)}</p>` : ''
  return `<h2><a class="mono" href="#trace-${encodeURIComponent(id)}" title="${esc(t('Trace from {id}', { id }))}">${esc(id)}</a> ${esc(name)} ${source}</h2>
    ${steps ? `<div class="issue-steps">${steps}</div>` : ''}${now}`
}

/**
 * 課題ごとに、見出しと、その課題の今日・次の作業日・相談・台帳の整備の行を並べる。課題の無い行は最後にまとめる
 * @param {readonly DailyEntry[]} entries
 * @param {IssueContext} ctx
 */
export function issueGroupsHtml(entries, ctx) {
  const ids = [...new Set(entries.flatMap(e => (e.issue ? [e.issue] : [])))]
  const groups = [...ids.map(id => /** @type {const} */ ([id, entries.filter(e => e.issue === id)])), /** @type {const} */ (['', entries.filter(e => !e.issue)])]
  let no = 0
  return groups.map(([id, rows]) => {
    const parts = PARTS.map(([section, label]) => {
      const list = rows.filter(e => e.section === section)
      return list.length ? `<h3>${esc(t(label))}</h3><ol class="daily-list">${list.map(e => ctx.row(e, ++no)).join('')}</ol>` : ''
    }).join('')
    if (!id && !parts) return ''
    const head = id ? headHtml(id, rows, ctx) : `<h2>${esc(t('Rows without an issue'))}</h2>`
    return `<section class="daily-section daily-issue" data-issue="${esc(id)}">${head}${parts || `<p class="cond">${esc(t('Nothing'))}</p>`}</section>`
  }).join('')
}
