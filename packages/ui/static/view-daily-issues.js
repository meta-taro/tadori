// 1 日の進行を「課題ごと」のツリーに並べる：課題 → 工程 → その工程の行（今日・次の作業日・相談）。
// 1 つの案件で課題が何本も並行するときに、どの課題のどの工程の作業かを読み違えないため（朝会のカンペにそのまま使える）。
// 行の中身は欄ごとの並びと同じ（直す・消す・印を変えるも同じ口）。並べ方だけを変える
import { t } from './i18n.js'
import { esc, webUrl } from './util.js'

/** @typedef {import('./types').DailyEntry} DailyEntry */

/** 工程の中で並べる欄の順（要約は課題の見出しの直下に出すので、ここには入れない） */
const PARTS = /** @type {const} */ ([['today', 'Today'], ['next', 'Next working day'], ['consult', 'Questions'], ['upkeep', 'Ledger upkeep']])

/** 行の頭の【工程名】（WBS の作業が付いていない行の工程） */
const STEP_HEAD = /^【([^】]{1,40})】\s*/

/**
 * @typedef {object} IssueContext
 * @property {(entry: DailyEntry, no: number) => string} row 1 行を描く（欄ごとの並びと同じ行）
 * @property {readonly import('./types').Item[]} items 台帳の行（課題の短い名前）
 * @property {readonly import('./types').Task[]} tasks WBS の作業（工程の名前と状態）
 * @property {readonly import('./types').StatusDef[]} statuses 状態の名前
 * @property {Readonly<Record<string, { label: string, url: string }>>} issueLinks 課題の正本の WBS の行
 * @property {(tag: string) => string} tagWord 行の印の言葉（作業中・待ち など）
 */

/**
 * @typedef {object} TreeStep
 * @property {string} key 工程を見分ける鍵（WBS の作業 ID か【工程名】。どちらも無ければ空）
 * @property {string} label 工程の名前
 * @property {string} status WBS の作業の状態の名前（WBS の作業でなければ空）
 * @property {string} tone 状態の色
 * @property {DailyEntry[]} rows
 */

/**
 * @typedef {object} TreeIssue
 * @property {string} id 課題番号（課題の無い行のまとまりは空）
 * @property {string} name 課題の短い名前
 * @property {{ label: string, url: string } | undefined} link 正本の WBS の行
 * @property {DailyEntry | undefined} summary 課題ごとの要約
 * @property {DailyEntry | undefined} latest 今の 1 行（要約が無いときの、いちばん新しく直した行）
 * @property {TreeStep[]} steps
 */

/**
 * 課題の「今」の 1 行：いちばん新しく直した行（直した時刻が無ければ最後の行）。台帳の整備の行は入れない
 * @param {readonly DailyEntry[]} rows
 * @returns {DailyEntry | undefined}
 */
export function latestOf(rows) {
  const work = rows.filter(e => e.section !== 'upkeep' && e.section !== 'summary')
  // 直した時刻は分までなので、同じ時刻なら後ろ（あとから足した・直した）行を選ぶ
  const newest = work.reduce((/** @type {DailyEntry | undefined} */ best, e) => (e.updated && (!best?.updated || e.updated >= best.updated) ? e : best), undefined)
  return newest ?? work.at(-1)
}

/**
 * 行の本文から、見出しに出ている「課題番号 短い名前」と【工程名】を外した文（ツリーの中では繰り返さない）
 * @param {DailyEntry} entry
 * @param {string} name
 */
export function bodyOf(entry, name) {
  const id = entry.issue ?? ''
  const head = id ? [`${id} ${name} `, `${id} `].find(prefix => entry.text.startsWith(prefix)) : undefined
  return entry.text.slice(head?.length ?? 0).replace(STEP_HEAD, '')
}

/**
 * 行の工程：付いている WBS の作業（最初の 1 つ）、無ければ本文の頭の【工程名】
 * @param {DailyEntry} entry
 * @param {string} name
 * @param {IssueContext} ctx
 * @returns {Omit<TreeStep, 'rows'>}
 */
function stepOf(entry, name, ctx) {
  const taskId = entry.wbs[0]
  if (taskId) {
    const task = ctx.tasks.find(x => x.id === taskId)
    const status = ctx.statuses.find(s => s.id === task?.status)
    return { key: taskId, label: task ? `${task.name}（${taskId}）` : taskId, status: status?.name ?? task?.status ?? '', tone: status?.tone ?? 'none' }
  }
  const id = entry.issue ?? ''
  const rest = id ? entry.text.replace(new RegExp(`^${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+(${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+)?`), '') : entry.text
  const named = rest.match(STEP_HEAD)?.[1]
  return named ? { key: `【${named}】`, label: named, status: '', tone: 'none' } : { key: '', label: '', status: '', tone: 'none' }
}

/**
 * 1 日の進行の行を、課題 → 工程 → 行のツリーにする。課題は出てきた順、課題の無い行は最後
 * @param {readonly DailyEntry[]} entries
 * @param {IssueContext} ctx
 * @returns {TreeIssue[]}
 */
export function issueTree(entries, ctx) {
  const ids = [...new Set(entries.flatMap(e => (e.issue ? [e.issue] : [])))]
  return [...ids, ''].flatMap(id => {
    const rows = entries.filter(e => (e.issue ?? '') === id)
    if (!rows.length) return []
    const item = id ? ctx.items.find(i => i.id === id) : undefined
    const name = item ? (item.fields.short || item.title) : ''
    /** @type {TreeStep[]} */
    const steps = []
    for (const entry of rows.filter(e => e.section !== 'summary')) {
      const step = stepOf(entry, name, ctx)
      const found = steps.find(s => s.key === step.key)
      if (found) found.rows.push(entry); else steps.push({ ...step, rows: [entry] })
    }
    // 工程の名前の無い行は、その課題の最後にまとめる
    steps.sort((a, b) => Number(!a.key) - Number(!b.key))
    const summary = rows.find(e => e.section === 'summary')
    return [{ id, name, link: id ? ctx.issueLinks[id] : undefined, summary, latest: summary ? undefined : latestOf(rows), steps }]
  })
}

/** @param {{ label: string, url: string } | undefined} link */
const sourceLink = link => {
  const url = webUrl(link?.url)
  return url ? `<a class="daily-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer" data-external title="${esc(url)}">${esc(link?.label ?? 'WBS')} ↗</a>` : ''
}

/**
 * 課題の見出し：課題番号・短い名前・正本の WBS、その直下に要約（無ければ今の 1 行）
 * @param {TreeIssue} issue
 * @param {IssueContext} ctx
 */
function headHtml(issue, ctx) {
  if (!issue.id) return `<h2>${esc(t('Rows without an issue'))}</h2>`
  const now = issue.summary ?? issue.latest
  const word = !issue.summary && now?.tag ? ctx.tagWord(now.tag) : ''
  const label = issue.summary ? t('Summary') : t('Now')
  return `<h2><a class="mono" href="#trace-${encodeURIComponent(issue.id)}" title="${esc(t('Trace from {id}', { id: issue.id }))}">${esc(issue.id)}</a> ${esc(issue.name)} ${sourceLink(issue.link)}</h2>
    ${now ? `<p class="issue-now"><span class="cond">${esc(label)}</span> ${word ? `<span class="daily-pill">${esc(word)}</span>` : ''}${esc(bodyOf(now, issue.name))}</p>` : ''}`
}

/**
 * 工程の見出し（WBS の作業なら状態の札も）
 * @param {TreeStep} step
 */
const stepHead = step => (step.key
  ? `<h3 class="issue-step">${esc(step.label)}${step.status ? ` <span class="chip ${esc(step.tone)}"><span class="dot"></span>${esc(step.status)}</span>` : ''}</h3>`
  : `<h3 class="issue-step cond">${esc(t('Other work'))}</h3>`)

/**
 * 行の一覧（上の欄）を、課題 → 工程 → 欄 → 行のツリーで描く。行はその場で直せる
 * @param {readonly DailyEntry[]} entries
 * @param {IssueContext} ctx
 */
export function issueGroupsHtml(entries, ctx) {
  let no = 0
  return issueTree(entries, ctx).map(issue => {
    const steps = issue.steps.map(step => {
      const parts = PARTS.map(([section, label]) => {
        const list = step.rows.filter(e => e.section === section)
        return list.length ? `<h4>${esc(t(label))}</h4><ol class="daily-list">${list.map(e => ctx.row(e, ++no)).join('')}</ol>` : ''
      }).join('')
      return `<div class="issue-step-block" data-step="${esc(step.key)}">${stepHead(step)}${parts}</div>`
    }).join('')
    return `<section class="daily-section daily-issue" data-issue="${esc(issue.id)}">${headHtml(issue, ctx)}${steps || `<p class="cond">${esc(t('Nothing'))}</p>`}</section>`
  }).join('')
}

/**
 * 1 行の読み上げの形：欄の言葉・印・本文（課題番号と工程は上の段に出ているので繰り返さない）
 * @param {DailyEntry} entry
 * @param {string} name
 * @param {IssueContext} ctx
 */
function lineOf(entry, name, ctx) {
  const section = PARTS.find(([id]) => id === entry.section)?.[1] ?? ''
  const word = entry.tag ? ctx.tagWord(entry.tag) : ''
  const badges = (entry.badges ?? []).map(b => `〈${b.text}〉`).join('')
  return { section: t(section), word, text: `${bodyOf(entry, name)}${badges}` }
}

/**
 * 文の形のツリー（画面に描く HTML）。朝会のカンペにそのまま読める形
 * @param {readonly DailyEntry[]} entries
 * @param {IssueContext} ctx
 */
export function issueTreeHtml(entries, ctx) {
  return `<div class="daily-tree">${issueTree(entries, ctx).map(issue => {
    const head = issue.id ? `<span class="mono">${esc(issue.id)}</span> ${esc(issue.name)} ${sourceLink(issue.link)}` : esc(t('Rows without an issue'))
    const summary = issue.summary ? `<li class="tree-summary"><span class="cond">${esc(t('Summary'))}</span> ${esc(bodyOf(issue.summary, issue.name))}</li>` : ''
    const steps = issue.steps.map(step => {
      const rows = PARTS.flatMap(([section]) => step.rows.filter(e => e.section === section)).map(e => {
        const line = lineOf(e, issue.name, ctx)
        return `<li><span class="cond">${esc(line.section)}</span> ${line.word ? `<span class="daily-pill">${esc(line.word)}</span>` : ''}${esc(line.text)}</li>`
      }).join('')
      const label = step.key ? `${esc(step.label)}${step.status ? ` <span class="chip ${esc(step.tone)}"><span class="dot"></span>${esc(step.status)}</span>` : ''}` : `<span class="cond">${esc(t('Other work'))}</span>`
      return `<li class="tree-step">${label}<ul>${rows}</ul></li>`
    }).join('')
    return `<section class="tree-issue" data-issue="${esc(issue.id)}"><h3>${head}</h3><ul>${summary}${steps}</ul></section>`
  }).join('')}</div>`
}

/**
 * 文の形のツリー（「文をコピー」で出す文字）。字下げで段を表す
 * @param {readonly DailyEntry[]} entries
 * @param {IssueContext} ctx
 */
export function issueTreeText(entries, ctx) {
  return issueTree(entries, ctx).map(issue => {
    const url = webUrl(issue.link?.url)
    const head = issue.id ? `■ ${issue.id} ${issue.name}${url ? `（${issue.link?.label ?? 'WBS'}：${url}）` : ''}` : `■ ${t('Rows without an issue')}`
    const summary = issue.summary ? [`  ${t('Summary')}：${bodyOf(issue.summary, issue.name)}`] : []
    const steps = issue.steps.flatMap(step => [
      `  ・${step.key ? `${step.label}${step.status ? `（${step.status}）` : ''}` : t('Other work')}`,
      ...PARTS.flatMap(([section]) => step.rows.filter(e => e.section === section)).map(e => {
        const line = lineOf(e, issue.name, ctx)
        return `    ${line.section}${line.word ? `［${line.word}］` : '：'}${line.text}`
      }),
    ])
    return [head, ...summary, ...steps].join('\n')
  }).join('\n\n')
}
