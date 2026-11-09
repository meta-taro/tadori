// 1 日の進行の「文の形」を、Markdown を描いたときのように見せる（文そのもの＝「文をコピー」で出す文字は変えない）。
// - 段落の頭の行は見出し（今日・次の作業日・相談・台帳の整備・補足）。段落の中の番号の無い行は小見出し
// - 「1. 」で始まる行は字下げした番号付きの一覧
// - 印（例：［済］）は小さな札
// - WBS・課題は文字を押すと画面の中のその場所へ、正本などの URL は「正本 ↗」の文字で開く（URL をそのまま出さない）
import { esc, webUrl } from './util.js'

const URL_PATTERN = 'https?:\\/\\/[^\\s（）()]+'
const escapeRegExp = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** 1 行の中の印・リンクを、札とリンクにする（それ以外の文字はそのまま出す） */
function inlineHtml(line, links, tags) {
  const byText = new Map(links.map(l => [l.text, l.href]))
  const words = [...tags, ...byText.keys()].filter(Boolean).sort((a, b) => b.length - a.length).map(escapeRegExp)
  // 「正本：URL」は「正本 ↗」に、ほかの URL は「リンク ↗」にする。長い言葉を先に当てる
  const pattern = new RegExp([`(正本：)?(${URL_PATTERN})`, ...words].join('|'), 'g')
  let html = ''
  let last = 0
  for (const match of line.matchAll(pattern)) {
    html += esc(line.slice(last, match.index))
    last = match.index + match[0].length
    const [text, originMark, url] = match
    if (url) {
      const href = webUrl(url)
      const label = originMark ? '正本 ↗' : 'リンク ↗'
      html += href ? `<a class="origin-link" href="${esc(href)}" target="_blank" rel="noopener noreferrer" data-external title="${esc(href)}">${label}</a>` : esc(text)
    } else if (tags.includes(text)) {
      // 札にするので、印を囲む括弧（［］【】[]）は見せない
      html += `<span class="daily-pill">${esc(text.replace(/^[［【[]|[］】\]]$/g, '') || text)}</span>`
    } else {
      html += `<a class="daily-ref mono" href="${esc(byText.get(text))}">${esc(text)}</a>`
    }
  }
  return html + esc(line.slice(last))
}

/** 文全体を、見出し・番号付きの一覧・小見出しに分けて描く */
export function previewHtml(text, links = [], tags = []) {
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
        ? `<li value="${Number(item[1])}">${inlineHtml(item[2], links, tags)}</li>`
        : `<h4>${inlineHtml(line, links, tags)}</h4>`
    }
    if (listOpen) body += '</ol>'
    return `<section class="daily-preview-block"><h3>${inlineHtml(head, links, tags)}</h3>${body}</section>`
  }).join('')
}
