// 1 日の進行の「文の形」を、Markdown を描いたときのように見せる（文そのもの＝「文をコピー」で出す文字は変えない）。
// - 段落の頭の行は見出し（今日・次の作業日・相談・台帳の整備・補足）。段落の中の番号の無い行は小見出し
// - 「1. 」で始まる行は字下げした番号付きの一覧
// - 印（例：［済］）は小さな札
// - WBS・課題は文字を押すと画面の中のその場所へ、正本などの URL は「正本 ↗」の文字で開く（URL をそのまま出さない）
import { esc, webUrl } from './util.js'

// URL は空白・括弧・補足の区切り（／・、）の手前まで
const URL_PATTERN = 'https?:\\/\\/[^\\s（）()／、]+'
// 「表示名：URL」の表示名（空白・括弧・区切りを含まない 40 文字まで）
const LABEL_PATTERN = '[^\\s：（）()、／]{1,40}'
const escapeRegExp = (/** @type {string} */ s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * 文の中のリンク（Daily の links と同じ形）
 * @typedef {import('./types').Daily['links'][number]} DailyTextLink
 */

/**
 * 1 行の中の印・リンクを、札とリンクにする（それ以外の文字はそのまま出す）
 * @param {string} line
 * @param {readonly DailyTextLink[]} links
 * @param {readonly string[]} tags
 * @param {readonly string[]} [whoMarks]
 */
function inlineHtml(line, links, tags, whoMarks = []) {
  const byText = new Map(links.map(l => [l.text, l.href]))
  const words = [...tags, ...whoMarks, ...byText.keys()].filter(Boolean).sort((a, b) => b.length - a.length).map(escapeRegExp)
  // 「表示名：URL」（例：正本：…・QA表：…）は「表示名 ↗」に、名前の無い URL は「リンク ↗」にする。長い言葉を先に当てる
  const pattern = new RegExp([`(?:(${LABEL_PATTERN})：)?(${URL_PATTERN})`, ...words].join('|'), 'g')
  let html = ''
  let last = 0
  for (const match of line.matchAll(pattern)) {
    // matchAll で取れた一致には、かならず index がある
    const index = match.index ?? 0
    html += esc(line.slice(last, index))
    last = index + match[0].length
    const [text, name, url] = match
    if (url) {
      const href = webUrl(url)
      const label = `${name || 'リンク'} ↗`
      html += href ? `<a class="origin-link" href="${esc(href)}" target="_blank" rel="noopener noreferrer" data-external title="${esc(href)}">${esc(label)}</a>` : esc(text)
    } else if (whoMarks.includes(text)) {
      // 担当で絞っていないときの行の担当（例：設計担当：）。区切りの「：」は札に出さない
      html += `<span class="daily-who">${esc(text.replace(/[：:]\s*$/, '') || text)}</span>`
    } else if (tags.includes(text)) {
      // 札にするので、印を囲む括弧（［］【】[]）は見せない
      html += `<span class="daily-pill">${esc(text.replace(/^[［【[]|[］】\]]$/g, '') || text)}</span>`
    } else {
      html += `<a class="daily-ref mono" href="${esc(byText.get(text))}">${esc(text)}</a>`
    }
  }
  return html + esc(line.slice(last))
}

/**
 * 文全体を、見出し・番号付きの一覧・小見出しに分けて描く
 * @param {string | null | undefined} text
 * @param {readonly DailyTextLink[]} [links]
 * @param {readonly string[]} [tags]
 * @param {readonly string[]} [whoMarks]
 */
export function previewHtml(text, links = [], tags = [], whoMarks = []) {
  const blocks = String(text ?? '').split(/\n{2,}/).map(b => b.split('\n').filter(l => l.trim()))
  return blocks.filter(lines => lines.length).map(lines => {
    const [head, ...rest] = lines
    let body = ''
    let listOpen = false
    for (const line of rest) {
      const item = line.match(/^(\d+)\.\s?(.*)$/)
      if (item && !listOpen) { body += '<ol class="daily-preview-list">'; listOpen = true }
      if (!item && listOpen) { body += '</ol>'; listOpen = false }
      body += item
        ? `<li value="${Number(item[1])}">${inlineHtml(item[2], links, tags, whoMarks)}</li>`
        : `<h4>${inlineHtml(line, links, tags)}</h4>`
    }
    if (listOpen) body += '</ol>'
    return `<section class="daily-preview-block"><h3>${inlineHtml(head, links, tags)}</h3>${body}</section>`
  }).join('')
}
