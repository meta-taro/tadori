// 1 日の進行：担当ごとに見て、その場で直す（プロダクト単位の残課題とは別に、人単位で見る）。
// 材料（WBS の状態の変化・台帳の差分・チェックの記録）から作った下書きを、日ごとのファイルに置き、行を足す・直す・消す。
// 直した行・足した行・消した行は、下書きを作り直しても上書きしない。
import { api, esc, getWho, ICON_INFO, toast, toastCommit } from './util.js'

// 担当は上の帯で選ぶ（どの画面も同じ）
let date = ''

const SECTIONS = [['today', '今日'], ['next', '次の作業日'], ['consult', '相談']]
const ORIGIN_LABEL = { edited: '直した行', manual: '足した行' }

/** 1 行：番号・本文（その場で直せる）・担当・消すボタン */
function entryRow(entry, no) {
  const badge = ORIGIN_LABEL[entry.origin] ? `<span class="chip mono">${ORIGIN_LABEL[entry.origin]}</span>` : ''
  const wbs = entry.wbs.length ? `<span class="cond mono">${esc(entry.wbs.join('・'))}</span>` : ''
  return `<li class="daily-entry">
    <span class="daily-no">${no}.</span>
    <input class="inline-input daily-text" data-entry="${esc(entry.id)}" value="${esc(entry.text)}" aria-label="${no} 番の本文" maxlength="500">
    <span class="daily-meta">${badge}<span class="cond">${esc(entry.who || '担当なし')}</span>${wbs}</span>
    <button type="button" class="btn-ghost" data-remove="${esc(entry.id)}" aria-label="${no} 番を消す">消す</button>
  </li>`
}

function sectionsHtml(entries) {
  let no = 0
  return SECTIONS.map(([id, label]) => {
    const list = entries.filter(e => e.section === id)
    const rows = list.map(e => entryRow(e, ++no)).join('')
    return `<section class="daily-section"><h2>${label}${id === 'today' ? ` ${list.length}件` : ''}</h2>
      ${rows ? `<ol class="daily-list">${rows}</ol>` : `<p class="cond">${id === 'consult' ? '下の欄から足せます' : 'ありません'}</p>`}</section>`
  }).join('')
}

async function write(path, method, body, what, rerender) {
  try {
    const result = await api(path, { method, body: body ?? {} })
    toastCommit(what, result.commit)
  } catch (error) {
    toast(`${what}できませんでした：${error.message}`)
  }
  rerender()
}

export async function renderDaily(view, state) {
  date ||= state.today
  const rerender = () => renderDaily(view, state)
  let daily
  try {
    const who = getWho()
    daily = await api(`/api/daily?date=${encodeURIComponent(date)}${who ? `&who=${encodeURIComponent(who)}` : ''}`)
  } catch (error) {
    view.innerHTML = `<h1>1 日の進行</h1><div class="note">${ICON_INFO}<span>${esc(error.message)}</span></div>`
    return
  }
  const base = `/api/daily/${encodeURIComponent(date)}`
  view.innerHTML = `
    <h1>1 日の進行</h1>
    <p class="lede">${daily.intro ? esc(daily.intro) : `担当ごとの 1 日の進行です。WBS の状態の変化・台帳の差分・チェックの記録から下書きを作ります。
      文はその場で直せます。直した行・足した行・消した行は、下書きを作り直しても残ります。`}</p>
    <div class="daily-bar">
      <label class="cond">日付 <input id="daily-date" class="inline-input" type="date" value="${esc(date)}"></label>
      <button type="button" class="btn-primary" id="daily-generate">${daily.saved ? '下書きを作り直す' : '下書きを作る'}</button>
      <button type="button" class="btn-ghost" id="daily-copy">文をコピー</button>
    </div>
    ${daily.saved ? '' : `<div class="note">${ICON_INFO}<span>まだ日ごとのファイルに置いていない下書きです。直したり足したりすると、その時点で置かれます。</span></div>`}
    <div class="panel daily-sheet">
      ${sectionsHtml(daily.entries)}
      <form class="add" id="daily-add">
        <label>見出し<select name="section">${SECTIONS.map(([id, label]) => `<option value="${id}" ${id === 'consult' ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
        <label>担当<input name="who" value="${esc(getWho())}" maxlength="100"></label>
        <label class="grow">本文<input name="text" required maxlength="500" placeholder="例：試験の環境はいつ空くか確かめたい"></label>
        <div class="actions"><button type="submit" class="btn-primary">足す</button></div>
      </form>
    </div>
    <h2>文の形（補足つき）</h2>
    <pre class="panel daily-preview">${esc(daily.text)}</pre>`

  view.querySelector('#daily-date').addEventListener('change', e => { if (e.target.value) { date = e.target.value; rerender() } })
  view.querySelector('#daily-generate').addEventListener('click', () => write(`${base}/generate`, 'POST', {}, '1 日の進行の下書き', rerender))
  view.querySelectorAll('[data-entry]').forEach(input => input.addEventListener('change', () =>
    write(`${base}/entries/${encodeURIComponent(input.dataset.entry)}`, 'PUT', { text: input.value }, '行', rerender)))
  view.querySelectorAll('[data-remove]').forEach(button => button.addEventListener('click', () =>
    write(`${base}/entries/${encodeURIComponent(button.dataset.remove)}`, 'DELETE', {}, '行の削除', rerender)))
  view.querySelector('#daily-add').addEventListener('submit', e => {
    e.preventDefault()
    const f = new FormData(e.target)
    write(`${base}/entries`, 'POST', { section: f.get('section'), who: String(f.get('who') ?? '').trim(), text: String(f.get('text') ?? '').trim() }, '行', rerender)
  })
  view.querySelector('#daily-copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(daily.text)
      toast('文をコピーしました', 2000)
    } catch {
      toast('コピーできませんでした。下の文を選んでコピーしてください')
    }
  })
}
