// 1 日の進行を「課題ごと」のツリーに並べる：課題 → 工程 → その工程の行（今日・次の作業日・相談）。
// 1 つの案件で課題が何本も並行するときに、どの課題のどの工程の作業かを読み違えないため（朝会のカンペにそのまま使える）。
// 行の中身は欄ごとの並びと同じ（直す・消す・印を変えるも同じ口）。並べ方だけを変える
import { t } from './i18n.js'
import { esc, highlightedHtml, isLocalRef, localLinkHtml, nthIndexOf, webUrl } from './util.js'

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
 * @property {readonly import('./types').Phase[]} phases 工程の並び（工程の段を WBS の順に並べる）
 * @property {Readonly<Record<string, { label: string, url: string }>>} issueLinks 課題の正本の WBS の行
 * @property {(tag: string) => string} tagWord 行の印の言葉（作業中・待ち など）
 * @property {Readonly<Record<string, import('./types').Origin>>} origins 台帳の行の正本（課題番号を押すと正本の課題へ）
 * @property {boolean} useWbsField 案件が issue_link_field を決めているか
 */

/**
 * @typedef {object} TreeStep
 * @property {string} key 工程を見分ける鍵（WBS の作業 ID か【工程名】。どちらも無ければ空）
 * @property {string} label 工程の名前
 * @property {string} status WBS の作業の状態の名前（WBS の作業でなければ空）
 * @property {string} tone 状態の色
 * @property {readonly import('./types').TaskLink[]} [links] 当てた WBS の作業の成果物へのリンク（wbs.tsv の links 列）
 * @property {string} [taskId] 当てた WBS の作業 ID
 * @property {DailyEntry[]} rows
 */

/**
 * @typedef {object} TreeIssue
 * @property {string} id 課題番号（課題の無い行のまとまりは空）
 * @property {string} name 課題の短い名前
 * @property {{ label: string, url: string } | undefined} link 正本の WBS の行
 * @property {DailyEntry | undefined} summary 課題ごとの要約
 * @property {DailyEntry | undefined} latest 今の 1 行（要約が無いときの、いちばん新しく直した行）
 * @property {TreeStep[]} steps 本筋の工程（今日こちらが手を動かす行。待ちの行は入れない）
 * @property {DailyEntry[]} waits 待ちの行（相手の返事やレビューを待つ行。本筋とは分けて小さく出す）
 * @property {'active' | 'waiting' | 'other'} kind 今日動かす課題 / 待ちだけの課題 / それ以外（台帳の整備だけなど、今日の課題ではない）
 */

/** 待ちの行か（印が待ち） */
const isWait = (/** @type {DailyEntry} */ e) => e.tag === 'wait'
/** 今日こちらが手を動かす行か（今日・次の作業日・相談で、待ちでないもの） */
const isWork = (/** @type {DailyEntry} */ e) => (e.section === 'today' || e.section === 'next' || e.section === 'consult') && !isWait(e)

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
  // 同じ正本の課題（source の URL が同じ）につながる台帳の ID は、1 つの課題にまとめる（今日動かす課題と待ちに分かれて 2 度出ないように）
  // 正本の場所（課題キーなど）まで決まっている行だけをまとめる（正本の表の URL だけの行は、どれも同じ URL になるため）
  const keyOf = (/** @type {string} */ issue) => (issue ? (ctx.origins[issue]?.place ? webUrl(ctx.origins[issue]?.url) : '') || issue : '')
  const keys = [...new Set(entries.flatMap(e => (e.issue ? [keyOf(e.issue)] : [])))]
  return [...keys, ''].flatMap(key => {
    const rows = entries.filter(e => keyOf(e.issue ?? '') === key)
    if (!rows.length) return []
    const id = rows.find(e => e.issue)?.issue ?? ''
    const item = id ? ctx.items.find(i => i.id === id) : undefined
    const name = item ? (item.fields.short || item.title) : ''
    /** @type {TreeStep[]} */
    const steps = []
    for (const entry of rows.filter(e => e.section !== 'summary' && !isWait(e))) {
      const step = stepOf(entry, name, ctx)
      const found = steps.find(s => s.key === step.key)
      if (found) found.rows.push(entry); else steps.push({ ...step, rows: [entry] })
    }
    // 工程の段は WBS の並び（wbs.tsv の順）に並べる。足した順にしない。WBS に無い【工程名】はそのあと、工程の無い行は最後
    // 【工程名】は、この課題の WBS の作業から先に当て（ほかの課題の作業に当てない）、同じ名前を部分一致より先にする
    const issueIds = new Set(rows.flatMap(e => (e.issue ? [e.issue] : [])))
    const own = ctx.tasks.filter(task => task.issue && issueIds.has(task.issue))
    const phaseRank = (/** @type {import('./types').Task} */ task) => {
      const at = ctx.phases.findIndex(p => p.id === task.phase)
      return at >= 0 ? at : ctx.phases.length
    }
    // 並びの重み：工程（phase）の順 → wbs.tsv の行の順
    const rank = (/** @type {import('./types').Task} */ task) => phaseRank(task) * 100_000 + ctx.tasks.indexOf(task)
    /** 工程に当たる WBS の作業（ID が先。【工程名】なら名前で当てる） */
    const taskOf = (/** @type {TreeStep} */ step) => {
      if (!step.key) return undefined
      const byId = ctx.tasks.find(task => task.id === step.key)
      if (byId) return byId
      const match = (/** @type {readonly import('./types').Task[]} */ list) =>
        list.find(task => task.name === step.label) ?? list.find(task => task.name.endsWith(step.label)) ?? list.find(task => task.name.includes(step.label))
      return match(own) ?? match(ctx.tasks)
    }
    const orderOf = (/** @type {TreeStep} */ step) => {
      if (!step.key) return Number.MAX_SAFE_INTEGER
      const task = taskOf(step)
      return task ? rank(task) : Number.MAX_SAFE_INTEGER - 1
    }
    // 当てた作業の成果物へのリンクも、工程の見出しに持たせる
    const sorted = [...steps].sort((a, b) => orderOf(a) - orderOf(b)).map(step => ({ ...step, links: taskOf(step)?.links ?? [], taskId: taskOf(step)?.id ?? '' }))
    const summary = rows.find(e => e.section === 'summary')
    const waits = rows.filter(isWait)
    /** @type {TreeIssue['kind']} */
    const kind = !id || rows.some(isWork) ? 'active' : waits.length ? 'waiting' : 'other'
    return [{ id, name, link: id ? ctx.issueLinks[id] : undefined, summary, latest: summary ? undefined : latestOf(rows), steps: sorted, waits, kind }]
  })
}

/**
 * 並べる順：今日動かす課題 → 待ちだけの課題 → 課題の無い行 → 今日の課題ではないもの
 * @param {TreeIssue[]} tree
 */
const ordered = tree => [
  ...tree.filter(i => i.id && i.kind === 'active'), ...tree.filter(i => i.kind === 'waiting'),
  ...tree.filter(i => !i.id), ...tree.filter(i => i.kind === 'other'),
]

/**
 * いちばん上の段：今日動かす課題を大きく、その下に待ちだけの課題を小さく（待ちの理由を 1 行）
 * @param {readonly DailyEntry[]} entries
 * @param {IssueContext} ctx
 */
export function focusHtml(entries, ctx) {
  const tree = issueTree(entries, ctx)
  const active = tree.filter(i => i.id && i.kind === 'active')
  const waiting = tree.filter(i => i.kind === 'waiting')
  if (!active.length && !waiting.length) return ''
  const big = active.map(i => `<li><span class="focus-id">${issueRefHtml(i.id, ctx.origins, ctx.issueLinks, ctx.useWbsField)}</span> <span class="focus-name">${esc(i.name)}</span></li>`).join('')
  const small = waiting.map(i => {
    const first = i.waits[0]
    return `<li><span class="mono">${esc(i.id)}</span> ${esc(i.name)}${first ? ` <span class="cond">— ${highlightedHtml(bodyOf(first, i.name), first)}</span>` : ''}</li>`
  }).join('')
  return `<div class="panel daily-focus" role="region" aria-label="${esc(t('Issues to move today'))}">
    <p class="cond">${esc(t('Issues to move today'))}</p>
    ${big ? `<ul class="focus-active">${big}</ul>` : `<p class="cond">${esc(t('No issue to move today (only waiting ones)'))}</p>`}
    ${small ? `<p class="cond focus-wait-head">${esc(t('Waiting (not moved today)'))}</p><ul class="focus-waiting">${small}</ul>` : ''}
  </div>`
}

/**
 * 課題の参照：正本の課題番号（台帳の source の場所。押すと正本の課題へ）・WBS ↗（正本の WBS の行）・台帳（tadori の中の行。小さく）。
 * 正本の設定が無い課題は、今までどおり課題 ID で tadori の中の行へ飛ぶ
 * @param {string} id 台帳の課題 ID
 * @param {Readonly<Record<string, import('./types').Origin>>} origins 台帳の行の正本（sources.tsv）
 * @param {Readonly<Record<string, { label: string, url: string }>>} links 課題の正本の WBS の行（issue_link_field）
 * @param {boolean} [useWbsField] 案件が issue_link_field を決めているか（決めていて URL が無いときは「WBS 未登録」と出す）
 */
export function issueRefHtml(id, origins, links, useWbsField = false) {
  const label = placeLabel(origins[id]?.place, id)
  const origin = origins[id]
  const url = webUrl(origin?.url)
  const trace = `#trace-${encodeURIComponent(id)}`
  const main = url
    ? `<a class="issue-ref mono" href="${esc(url)}" target="_blank" rel="noopener noreferrer" data-external title="${esc(t('Open the issue in the source of truth: {url}', { url }))}">${esc(label)} ↗</a>`
    : `<a class="issue-ref mono" href="${trace}" title="${esc(t('Trace from {id}', { id }))}">${esc(id)}</a>`
  const wbs = links[id] && webUrl(links[id].url)
    ? sourceLink(links[id])
    : useWbsField ? `<span class="chip wait" title="${esc(t('The source WBS row is not in the ledger'))}">${esc(t('WBS not set'))}</span>` : ''
  const ledger = url ? `<a class="issue-ledger cond" href="${trace}" title="${esc(t('Trace from {id}', { id }))}">${esc(t('Ledger'))}</a>` : ''
  return `<span class="issue-refs">${main}${wbs}${ledger}</span>`
}

/**
 * 正本の場所の見せ方：URL を書いた場所は、URL の最後の部分（課題キーなど）。無ければ台帳の ID
 * @param {string | undefined} place
 * @param {string} id
 */
export function placeLabel(place, id) {
  const text = (place ?? '').trim()
  if (!text) return id
  if (!/^https?:/i.test(text)) return text
  const last = text.replace(/[?#].*$/, '').replace(/[/]+$/, '').split('/').at(-1) ?? ''
  try { return decodeURIComponent(last) || id } catch { return last || id }
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
  return `<h2>${issueRefHtml(issue.id, ctx.origins, ctx.issueLinks, ctx.useWbsField)} ${esc(issue.name)}</h2>
    ${now ? `<p class="issue-now"><span class="cond">${esc(label)}</span> ${word ? `<span class="daily-pill">${esc(word)}</span>` : ''}${highlightedHtml(bodyOf(now, issue.name), now)}</p>` : ''}`
}

/**
 * 工程の名前を描く。成果物へのリンクの語（anchor）が名前にあればその語をリンクにし、無いリンクは名前の後ろに「表示名 ↗」で出す
 * @param {string} label
 * @param {readonly import('./types').TaskLink[]} [links]
 * @param {string} [taskId] 当てた WBS の作業 ID（手元のフォルダのリンクを開くとき、どの作業の何本目かを送るため）
 */
export function stepLabelHtml(label, links = [], taskId = '') {
  /** @type {Array<{ start: number, end: number, label: string, url: string, index: number }>} */
  const spans = []
  /** @type {Array<{ label: string, url: string, index: number }>} */
  const tail = []
  links.forEach((link, index) => {
    // 手元のフォルダ・ファイルは、作業 ID が分かるときだけ出す（押すと tadori が OS に開かせる）
    const url = isLocalRef(link.url) ? (taskId ? link.url : '') : webUrl(link.url)
    if (!url) return
    const start = link.anchor ? nthIndexOf(label, link.anchor, link.nth ?? 1) : -1
    const end = start + (link.anchor?.length ?? 0)
    // 名前に無い語や、先に決まった語と重なる語は、後ろに出す
    if (start < 0 || spans.some(s => start < s.end && end > s.start)) tail.push({ label: link.label, url, index })
    else spans.push({ start, end, label: link.label, url, index })
  })
  spans.sort((a, b) => a.start - b.start)
  let html = ''
  let last = 0
  for (const s of spans) {
    html += esc(label.slice(last, s.start))
    const word = label.slice(s.start, s.end)
    html += isLocalRef(s.url)
      ? localLinkHtml(word, s.url, { kind: 'task', id: taskId, index: s.index }, 'daily-anchor')
      : `<a class="daily-anchor" href="${esc(s.url)}" target="_blank" rel="noopener noreferrer" data-external title="${esc(t('Open {label}: {url}', { label: s.label, url: s.url }))}">${esc(word)}</a>`
    last = s.end
  }
  html += esc(label.slice(last))
  return html + tail.map(l => ` ${isLocalRef(l.url)
    ? localLinkHtml(`${l.label} ↗`, l.url, { kind: 'task', id: taskId, index: l.index })
    : `<a class="daily-link" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer" data-external title="${esc(l.url)}">${esc(l.label)} ↗</a>`}`).join('')
}

/**
 * 文の形（コピーする文字）の工程の後ろに添える成果物へのリンク（「 ― 表示名：URL ／ 表示名：URL」）
 * @param {readonly import('./types').TaskLink[]} [links]
 */
const stepLinksText = (links = []) => {
  const list = links.flatMap(l => (webUrl(l.url) ? [`${l.label}：${webUrl(l.url)}`] : []))
  return list.length ? ` ― ${list.join(' ／ ')}` : ''
}

/**
 * 工程の見出し（WBS の作業なら状態の札も）
 * @param {TreeStep} step
 */
const stepHead = step => (step.key
  ? `<h3 class="issue-step">${stepLabelHtml(step.label, step.links, step.taskId)}${step.status ? ` <span class="chip ${esc(step.tone)}"><span class="dot"></span>${esc(step.status)}</span>` : ''}</h3>`
  : `<h3 class="issue-step cond">${esc(t('Other work'))}</h3>`)

/**
 * 行の一覧（上の欄）を、課題 → 工程 → 欄 → 行のツリーで描く。行はその場で直せる
 * @param {readonly DailyEntry[]} entries
 * @param {IssueContext} ctx
 */
export function issueGroupsHtml(entries, ctx) {
  let no = 0
  const sections = ordered(issueTree(entries, ctx)).map(issue => {
    const steps = issue.steps.map(step => {
      const parts = PARTS.map(([section, label]) => {
        const list = step.rows.filter(e => e.section === section)
        return list.length ? `<h4>${esc(t(label))}</h4><ol class="daily-list">${list.map(e => ctx.row(e, ++no)).join('')}</ol>` : ''
      }).join('')
      return `<div class="issue-step-block" data-step="${esc(step.key)}">${stepHead(step)}${parts}</div>`
    }).join('')
    // 待ちの行は本筋の工程に並べず、課題の最後の小さな段にまとめる
    const waits = issue.waits.length ? `<div class="issue-waits"><h4>${esc(t('Waiting'))}</h4><ol class="daily-list">${issue.waits.map(e => ctx.row(e, ++no)).join('')}</ol></div>` : ''
    return { issue, html: `<section class="daily-section daily-issue" data-issue="${esc(issue.id)}" data-kind="${issue.kind}">${headHtml(issue, ctx)}${steps}${waits}${steps || waits ? '' : `<p class="cond">${esc(t('Nothing'))}</p>`}</section>` }
  })
  // 今日の課題ではないもの（台帳の整備だけの課題など）は、たたんで最後に出す
  const others = sections.filter(x => x.issue.kind === 'other')
  return sections.filter(x => x.issue.kind !== 'other').map(x => x.html).join('')
    + (others.length ? `<details class="daily-others"><summary>${esc(t('Not today\'s issues ({n})', { n: others.length }))}</summary>${others.map(x => x.html).join('')}</details>` : '')
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
  return `<div class="daily-tree">${ordered(issueTree(entries, ctx)).map(issue => {
    const head = issue.id ? `${issueRefHtml(issue.id, ctx.origins, ctx.issueLinks, ctx.useWbsField)} ${esc(issue.name)}` : esc(t('Rows without an issue'))
    const summary = issue.summary ? `<li class="tree-summary"><span class="cond">${esc(t('Summary'))}</span> ${highlightedHtml(bodyOf(issue.summary, issue.name), issue.summary)}</li>` : ''
    const steps = issue.steps.map(step => {
      const rows = PARTS.flatMap(([section]) => step.rows.filter(e => e.section === section)).map(e => {
        const line = lineOf(e, issue.name, ctx)
        return `<li><span class="cond">${esc(line.section)}</span> ${line.word ? `<span class="daily-pill">${esc(line.word)}</span>` : ''}${highlightedHtml(bodyOf(e, issue.name), e)}${esc(line.text.slice(bodyOf(e, issue.name).length))}</li>`
      }).join('')
      const label = step.key ? `${stepLabelHtml(step.label, step.links, step.taskId)}${step.status ? ` <span class="chip ${esc(step.tone)}"><span class="dot"></span>${esc(step.status)}</span>` : ''}` : `<span class="cond">${esc(t('Other work'))}</span>`
      return `<li class="tree-step">${label}<ul>${rows}</ul></li>`
    }).join('')
    const waits = issue.waits.length ? `<li class="tree-waits"><span class="cond">${esc(t('Waiting'))}</span><ul>${issue.waits.map(e => `<li class="cond">${highlightedHtml(bodyOf(e, issue.name), e)}${esc(lineOf(e, issue.name, ctx).text.slice(bodyOf(e, issue.name).length))}</li>`).join('')}</ul></li>` : ''
    const notToday = issue.kind === 'other' ? ` <span class="chip">${esc(t('Not today'))}</span>` : ''
    return `<section class="tree-issue" data-issue="${esc(issue.id)}" data-kind="${issue.kind}"><h3>${head}${notToday}</h3><ul>${summary}${steps}${waits}</ul></section>`
  }).join('')}</div>`
}

/**
 * 文の形のツリー（「文をコピー」で出す文字）。字下げで段を表す
 * @param {readonly DailyEntry[]} entries
 * @param {IssueContext} ctx
 */
export function issueTreeText(entries, ctx) {
  return ordered(issueTree(entries, ctx)).map(issue => {
    const url = webUrl(issue.link?.url)
    // 課題番号は正本の番号（台帳の source の場所）があればそれ。正本の課題と WBS の URL を添える
    const origin = ctx.origins[issue.id]
    const sourceUrl = webUrl(origin?.url)
    const refs = [sourceUrl ? `${origin?.name || t('Source')}：${sourceUrl}` : '', url ? `${issue.link?.label ?? 'WBS'}：${url}` : ''].filter(Boolean).join(' ／ ')
    const head = issue.id ? `■ ${placeLabel(origin?.place, issue.id)} ${issue.name}${refs ? `（${refs}）` : ''}` : `■ ${t('Rows without an issue')}`
    const summary = issue.summary ? [`  ${t('Summary')}：${bodyOf(issue.summary, issue.name)}`] : []
    const steps = issue.steps.flatMap(step => [
      `  ・${step.key ? `${step.label}${step.status ? `（${step.status}）` : ''}${stepLinksText(step.links)}` : t('Other work')}`,
      ...PARTS.flatMap(([section]) => step.rows.filter(e => e.section === section)).map(e => {
        const line = lineOf(e, issue.name, ctx)
        return `    ${line.section}${line.word ? `［${line.word}］` : '：'}${line.text}`
      }),
    ])
    const waits = issue.waits.length ? [`  ・${t('Waiting')}`, ...issue.waits.map(e => `    ${lineOf(e, issue.name, ctx).text}`)] : []
    const mark = issue.kind === 'other' ? `（${t('Not today')}）` : ''
    return [`${head}${mark}`, ...summary, ...steps, ...waits].join('\n')
  }).join('\n\n')
}
