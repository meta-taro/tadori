// 節目の確かめの記録（.tadori/checkpoint-log.tsv）。1 行 = 1 回の確かめを新しい順に流し、押すと当てたルールと根拠が開く
import { t } from './i18n.js'
import { chip, esc, personChips } from './util.js'

/** @typedef {import('./types').ProjectState} ProjectState */
/** @typedef {ProjectState['checkpointLog'][number]} CheckpointRow */

/** まとめの行の rule の値（core の SUMMARY_RULE と同じ） */
const SUMMARY_RULE = '*'
/** コミット前の節目（対象は stage の印） */
const STAGED = 'before-commit'

/**
 * 1 回の確かめ
 * @typedef {{ run: string, when: string, who: string, at: string, target: string, ruleset: string, rows: CheckpointRow[] }} Run
 */

/** 書いた順の行を、回ごとにまとめる（新しい回が上） @param {readonly CheckpointRow[]} log @returns {Run[]} */
export function runsOf(log) {
  /** @type {Map<string, Run>} */
  const runs = new Map()
  for (const row of log) {
    const run = runs.get(row.run) ?? { run: row.run, when: row.when, who: row.who, at: row.at, target: row.target, ruleset: row.ruleset, rows: [] }
    if (row.rule !== SUMMARY_RULE) run.rows.push(row)
    runs.set(row.run, run)
  }
  return [...runs.values()].reverse()
}

/** 結果ごとの数 @param {Run} run */
const countsOf = run => {
  const n = (/** @type {string} */ result) => run.rows.filter(r => r.result === result).length
  return { total: run.rows.length, fixed: n('fixed'), open: n('open') }
}

/** 結果の一言と色 @param {Run} run */
function resultOf(run) {
  const { total, fixed, open } = countsOf(run)
  if (!fixed && !open) return { tone: 'ok', text: t('All {n} applicable rules OK', { n: total }) }
  const misses = fixed + open
  if (open) return { tone: 'hole', text: t('{misses} of {n} missed → not fixed ({open})', { misses, n: total, open }) }
  return { tone: 'wait', text: t('{misses} of {n} missed → fixed', { misses, n: total }) }
}

/** @param {ProjectState} state */
const checkpointName = state => (/** @type {string} */ at) => state.checkpoints.find(c => c.id === at)?.name ?? at

/** 対象の読み方（工程・タスクの名前。コミット前は stage の印） @param {ProjectState} state @param {Run} run */
function targetOf(state, run) {
  if (run.at === STAGED) return { id: '', label: t('Staged change ({digest})', { digest: run.target.slice(0, 8) }) }
  const task = state.tasks.find(x => x.id === run.target)
  const item = state.items.find(i => i.id === run.target)
  const phase = task ? state.phases.find(p => p.id === task.phase)?.name : ''
  return { id: run.target, label: [phase, task?.name ?? item?.title ?? ''].filter(Boolean).join(' / ') }
}

const RESULT_LABEL = /** @type {Record<string, [string, string]>} */ ({
  ok: ['ok', 'Checked'], na: ['none', 'Not applicable'], fixed: ['wait', 'Miss → fixed'], open: ['hole', 'Miss → not fixed'],
})

/** 当てたルールの表 @param {ProjectState} state @param {Run} run */
function rulesTable(state, run) {
  const rows = run.rows.map(r => {
    const rule = state.rules.find(x => x.id === r.rule)
    const [tone, label] = RESULT_LABEL[r.result] ?? ['', r.result]
    return `<tr><td class="mono">${esc(r.rule)}</td><td>${esc(rule ? (rule.check || rule.label) : t('(no longer in the rules)'))}</td>
      <td>${chip(tone, esc(t(label)))}</td><td class="mono cp-where">${esc(r.where)}</td><td>${esc(r.note)}</td></tr>`
  }).join('')
  return `<table class="cp-rules"><thead><tr><th>${esc(t('Rule'))}</th><th>${esc(t('Check item'))}</th><th>${esc(t('Result'))}</th><th>${esc(t('Where it was checked'))}</th><th>${esc(t('What was missing and what was done'))}</th></tr></thead><tbody>${rows}</tbody></table>`
}

/** 1 回の確かめの行 @param {ProjectState} state @param {Run} run */
function runRow(state, run) {
  const result = resultOf(run)
  const target = targetOf(state, run)
  return `<details class="cp-run ${result.tone}">
    <summary>
      <span class="cp-when mono">${esc(run.when.slice(0, 16))}</span>
      <span class="cp-target">${target.id ? `<span class="mono">${esc(target.id)}</span> ` : ''}${esc(target.label)}</span>
      <span class="cp-at">${esc(checkpointName(state)(run.at))}</span>
      <span class="cp-result">${chip(result.tone, esc(result.text))}</span>
      <span class="cp-who">${personChips(run.who)}</span>
    </summary>
    ${rulesTable(state, run)}
    <p class="cond">${esc(t('Ruleset at that time: {version}. Every rule that applied at this checkpoint then is listed above.', { version: run.ruleset || t('unknown') }))}</p>
  </details>`
}

/**
 * 報告用のまとめ（事実だけ：何回・何件当てた・何が抜けた・どうした。評価や点数は付けない）
 * @param {ProjectState} state @param {readonly Run[]} runs
 */
export function reportOf(state, runs) {
  if (!runs.length) return ''
  const days = runs.map(r => r.when.slice(0, 10)).sort()
  const range = days[0] === days.at(-1) ? days[0] : `${days[0]}〜${days.at(-1)}`
  const targets = [...new Set(runs.map(r => (r.at === STAGED ? t('staged changes') : r.target)))]
  const rules = runs.reduce((n, r) => n + r.rows.length, 0)
  const clear = runs.filter(r => resultOf(r).tone === 'ok').length
  const misses = runs.flatMap(r => r.rows.filter(x => x.result === 'fixed' || x.result === 'open').map(x => ({ run: r, row: x })))
  const fixed = misses.filter(m => m.row.result === 'fixed').length
  const head = t('{range}: {runs} checkpoint checks ({targets}). Rules checked: {rules} in total. All OK: {clear} times. Misses: {misses} (fixed {fixed}, not fixed {open}).', {
    range: range ?? '', runs: runs.length, targets: targets.join(t(', ')), rules, clear, misses: misses.length, fixed, open: misses.length - fixed,
  })
  const name = checkpointName(state)
  const lines = misses.map(({ run, row }) => {
    const rule = state.rules.find(x => x.id === row.rule)
    return t('- {date} {target} {at}: {rule} "{check}" → {status}: {note}', {
      date: run.when.slice(0, 10), target: run.at === STAGED ? t('staged changes') : run.target, at: name(run.at), rule: row.rule,
      check: rule ? (rule.check || rule.label) : '', status: t(row.result === 'fixed' ? 'fixed' : 'not fixed'), note: row.note,
    })
  })
  return [head, ...lines].join('\n')
}

const PERIODS = /** @type {const} */ ([['', 'All'], ['1', 'Today'], ['7', 'Last 7 days'], ['30', 'Last 30 days']])

/** 期間の始まり（YYYY-MM-DD）。空ならすべて @param {string} today @param {string} days */
function since(today, days) {
  if (!days) return ''
  const d = new Date(`${today}T00:00:00`)
  d.setDate(d.getDate() - Number(days) + 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 画面の中で覚えておく絞り込み */
const filter = { period: '', target: '' }

/**
 * 節目の確かめの欄を描く（チェックの記録の画面の上に置く）
 * @param {HTMLElement} holder @param {ProjectState} state
 */
export function renderCheckpoints(holder, state) {
  const all = runsOf(state.checkpointLog ?? [])
  const targets = [...new Set(all.filter(r => r.at !== STAGED).map(r => r.target))].sort()
  const draw = () => {
    const from = since(state.today, filter.period)
    const runs = all.filter(r => (!from || r.when.slice(0, 10) >= from) && (!filter.target || r.target === filter.target))
    const list = /** @type {HTMLElement} */ (holder.querySelector('.cp-list'))
    list.innerHTML = runs.length ? runs.map(r => runRow(state, r)).join('') : `<p class="cond">${esc(t('No checkpoint checks in this range'))}</p>`
    const report = /** @type {HTMLTextAreaElement} */ (holder.querySelector('#cp-report'))
    report.value = reportOf(state, runs)
  }
  holder.innerHTML = `
    <h2>${esc(t('Checks at checkpoints'))}</h2>
    <p class="lede">${esc(t('One row per check. At each checkpoint the agent checked every rule that applied, and wrote where it looked. Open a row to see the rules and the evidence.'))}</p>
    ${all.length ? `<div class="cp-filters">
      <label>${esc(t('Period'))} <select id="cp-period">${PERIODS.map(([v, l]) => `<option value="${v}" ${filter.period === v ? 'selected' : ''}>${esc(t(l))}</option>`).join('')}</select></label>
      <label>${esc(t('Task'))} <select id="cp-target"><option value="">${esc(t('All'))}</option>${targets.map(id => `<option value="${esc(id)}" ${filter.target === id ? 'selected' : ''}>${esc(id)}</option>`).join('')}</select></label>
    </div>
    <div class="cp-list"></div>
    <details class="cp-report-box" open>
      <summary>${esc(t('Summary for a report (facts only)'))}</summary>
      <textarea id="cp-report" readonly rows="5"></textarea>
      <button type="button" class="btn" id="cp-copy">${esc(t('Copy'))}</button>
    </details>` : `<p class="cond">${esc(t('No checkpoint checks yet. Give rules an "at" column, then agents record with checkpoint_record.'))}</p>`}`
  if (!all.length) return
  holder.querySelector('#cp-period')?.addEventListener('change', e => { filter.period = /** @type {HTMLSelectElement} */ (e.target).value; draw() })
  holder.querySelector('#cp-target')?.addEventListener('change', e => { filter.target = /** @type {HTMLSelectElement} */ (e.target).value; draw() })
  holder.querySelector('#cp-copy')?.addEventListener('click', async () => {
    const report = /** @type {HTMLTextAreaElement} */ (holder.querySelector('#cp-report'))
    try {
      await navigator.clipboard.writeText(report.value)
    } catch {
      // クリップボードを使えない画面（権限が無いなど）では、選んだ状態にして人に写してもらう
      report.select()
    }
  })
  draw()
}
