// 資料の版と差分：台帳の行が指す文書の、版の並び（git）と、2 つの版の差分。既定は「承認した版 → いま」
import { t } from './i18n.js'
import { api, esc, messageOf } from './util.js'

/** @typedef {{ commit: string, date: string, subject: string }} DocVersion */
/** @typedef {{ file: string, items: string[], approval: { rule: string, when: string, commit: string } | null, versions: DocVersion[], from: string, to: string, diff: string }} DocView */

/** 差分の 1 行の見た目（足した・消した・場所・そのまま） @param {string} line */
function diffLineClass(line) {
  if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff ') || line.startsWith('index ')) return 'diff-meta'
  if (line.startsWith('@@')) return 'diff-hunk'
  if (line.startsWith('+')) return 'diff-add'
  if (line.startsWith('-')) return 'diff-del'
  return ''
}

/** @param {string} diff */
const diffHtml = diff => `<pre class="doc-diff">${diff.split('\n').map(line => `<span class="${diffLineClass(line)}">${esc(line)}</span>`).join('\n')}</pre>`

/** @param {DocView} doc @param {string} id */
function versionsHtml(doc, id) {
  if (!doc.versions.length) return `<p class="cond">${esc(t('No versions: the document is not committed, or the project is not in git'))}</p>`
  const rows = doc.versions.map(v => {
    const isApproved = doc.approval?.commit === v.commit
    const isFrom = doc.from === v.commit
    return `<li class="doc-version${isFrom ? ' is-from' : ''}">
      <code>${esc(v.commit)}</code> <span class="doc-date">${esc(v.date.slice(0, 16).replace('T', ' '))}</span> ${esc(v.subject)}
      ${isApproved ? `<span class="chip ok"><span class="dot"></span>${esc(t('Approved version'))}</span>` : ''}
      ${isFrom ? '' : `<a class="btn-ghost doc-from" href="#doc-${encodeURIComponent(id)}~${esc(v.commit)}">${esc(t('Diff from this version'))}</a>`}
    </li>`
  }).join('')
  return `<ol class="doc-versions">${rows}</ol>`
}

/** @param {DocView} doc */
function diffSectionHtml(doc) {
  if (!doc.from) return `<p class="cond">${esc(t('No approval on record for this document. Choose a version to see what changed since then.'))}</p>`
  const why = doc.approval?.commit === doc.from
    ? t('Changes since the version approved on {when} ({rule})', { when: doc.approval.when, rule: doc.approval.rule })
    : t('Changes since {commit}', { commit: doc.from })
  return `<h2>${esc(why)}</h2>${doc.diff ? diffHtml(doc.diff) : `<p class="cond">${esc(t('No change'))}</p>`}`
}

/**
 * @param {HTMLElement} view
 * @param {import('./types').ProjectState} _state
 * @param {string} key 行の ID か文書の場所。「~commit」を付けると、その版からの差分
 */
export async function renderDoc(view, _state, key) {
  const hash = location.hash
  const [id = '', from = ''] = key.split('~')
  view.innerHTML = `<h1>${esc(t('Document versions'))}</h1><p class="cond">${esc(t('Loading…'))}</p>`
  /** @type {DocView} */
  let doc
  try {
    doc = await api(`/api/doc?id=${encodeURIComponent(id)}${from ? `&from=${encodeURIComponent(from)}` : ''}`)
  } catch (error) {
    if (location.hash !== hash) return
    view.innerHTML = `<h1>${esc(t('Document versions'))}</h1><p class="form-problems">${esc(messageOf(error))}</p>`
    return
  }
  // 読み込みの間に別の画面へ移っていたら描かない（遅れて返った答えで、移った先の画面を上書きしないように）
  if (location.hash !== hash) return
  const rows = doc.items.map(i => `<a href="#trace-${encodeURIComponent(i)}">${esc(i)}</a>`).join(' ')
  view.innerHTML = `
    <h1>${esc(t('Document versions'))}</h1>
    <p class="lede"><code>${esc(doc.file)}</code> · ${esc(t('Rows pointing here:'))} ${rows}</p>
    <section class="panel doc-panel">
      <h2>${esc(t('Versions (newest first)'))}</h2>
      ${versionsHtml(doc, id)}
    </section>
    <section class="panel doc-panel" id="doc-diff">${diffSectionHtml(doc)}</section>`
}
