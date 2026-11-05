// ルールセット・チェックの記録・1 件をたどる
import { api, chip, esc, ICON_INFO, kindLabel } from './util.js'

const KIND_NAMES = { covered: '下流が出ている', refers: '上流を元にしている', filled: '列が埋まっている', approval: '人の承認' }

export function renderRules(view, state) {
  const sets = state.phases.map(phase => {
    const rules = state.rules.filter(r => r.phase === phase.id)
    const rows = rules.map(r => `
      <tr>
        <td class="rule-id">${esc(r.id)}</td>
        <td><div class="pair">${r.from ? esc(kindLabel(r.from)) : ''}${r.to ? `<span class="arrow">→</span>${esc(kindLabel(r.to))}` : ''}${r.field ? ` の ${esc(r.field)}` : ''}</div>
            ${r.only ? `<div class="cond">${esc(r.only.field)} が「${esc(r.only.value)}」の行だけ</div>` : ''}</td>
        <td class="cond">${esc(r.label)}</td>
        <td class="kind">${KIND_NAMES[r.kind]}</td>
      </tr>`).join('')
    return `<details class="ruleset" open>
      <summary><span class="tw">›</span><span class="pair">${esc(phase.name)}</span><span class="count">${rules.length} 件</span></summary>
      ${rules.length ? `<table><thead><tr><th style="width:64px">ID</th><th style="width:34%">何と何が</th><th>条件</th><th style="width:150px">判定</th></tr></thead><tbody>${rows}</tbody></table>` : '<div class="empty">ルールはありません</div>'}
    </details>`
  }).join('')
  view.innerHTML = `
    <h1>ルールセット</h1>
    <p class="lede">工程ごとのルールセットです。エージェントは作業の前にこれを読んで守り、チェックした結果を記録に残します。人の承認が要るルールは、人がチェックします。</p>
    <div class="note">${ICON_INFO}<span>MVP では、ルールは <span class="mono">.tadori/rulesets/*.tsv</span> を直接編集して足します（画面からの追加は次の段）。</span></div>
    <div class="panel">${sets}</div>`
}

const RESULT_TONE = result => (/^漏れ|差し戻し/.test(result) ? 'hole' : /^満たす|承認/.test(result) ? 'ok' : '')

export function renderLog(view, state) {
  const rows = [...state.checks].reverse().map(r => `<tr>
    <td class="mono">${esc(r.when)}</td><td>${esc(r.who)}</td><td class="pair">${esc(r.what)}</td>
    <td class="mono src">${esc(r.where)}</td><td class="cond">${esc(r.why)}</td><td class="mono src">${esc(r.how)}</td>
    <td>${chip(RESULT_TONE(r.result), esc(r.result))}</td></tr>`).join('')
  view.innerHTML = `
    <h1>チェックの記録</h1>
    <p class="lede">ルールをチェックするたびに、5W1H で 1 行ずつ足していきます（<span class="mono">.tadori/checks.tsv</span>・git で管理）。人の承認の行は人が書きます。</p>
    <div class="note">${ICON_INFO}<span>記録を足すには <span class="mono">tadori check --log --who 名前 --why 理由</span> を使います。</span></div>
    <div class="panel"><table>
      <thead><tr><th>いつ</th><th>誰が</th><th>何を</th><th>どこで</th><th>なぜ</th><th>どうやって</th><th>結果</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="7" class="cond">まだ記録がありません</td></tr>'}</tbody>
    </table></div>`
}

const ICON_OK = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><path d="M3.5 8.5l3 3 6-7"/></svg>'
const ICON_NG = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4l8 8M12 4l-8 8"/></svg>'

function storyPath(result) {
  const parts = []
  result.steps.forEach((s, i) => {
    if (i > 0) parts.push(`<div class="sp-link ${s.type === 'missing' ? 'broken' : ''}"><span class="sp-line"></span><span class="sp-link-label">${s.type === 'missing' ? 'ここで切れている' : ''}</span></div>`)
    if (s.type === 'missing') {
      parts.push(`<div class="sp-card ng"><div class="sp-phase">${esc(s.rule)}</div><div class="sp-icon">${ICON_NG}</div>
        <div class="sp-kind">${esc(kindLabel(s.kind))}</div><div class="sp-say">${esc(kindLabel(s.kind))}が無い</div><div class="sp-src">台帳に ${esc(s.kind)} の行が無い</div></div>`)
    } else {
      const isStart = s.item.id === result.start.id
      parts.push(`<div class="sp-card ok ${isStart ? 'end' : ''}"><div class="sp-phase">${isStart ? '辿り始め' : ''}</div><div class="sp-icon">${ICON_OK}</div>
        <div class="sp-kind">${esc(kindLabel(s.item.kind))} <span class="mono">${esc(s.item.id)}</span></div>
        <div class="sp-say">${esc(s.item.title)}</div><div class="sp-src">${esc(s.item.source)}</div></div>`)
    }
  })
  return parts.join('')
}

export async function renderTrace(view, state, startId) {
  const options = state.items.map(i => `<option value="${esc(i.id)}" ${i.id === startId ? 'selected' : ''}>${esc(i.id)} · ${esc(kindLabel(i.kind))} · ${esc(i.title)}</option>`).join('')
  view.innerHTML = `
    <h1>1 件をたどる</h1>
    <div class="picker"><label class="cond">どこから辿る <select id="pick-start">${options}</select></label></div>
    <p class="lede">つながりは台帳に書かれた ID だけで tadori が判定します。推測でつなぎません。切れている所が赤です。</p>
    <div class="story-path" id="story" role="list"><div class="cond">読み込み中…</div></div>
    <div class="verdict"><span>この線のどこが漏れていたかを決めるのは人です。確かめたら、チェックの記録に人の行として残してください。</span></div>`
  view.querySelector('#pick-start').addEventListener('change', e => { location.hash = `trace-${encodeURIComponent(e.target.value)}` })
  try {
    const result = await api(`/api/trace/${encodeURIComponent(startId)}`)
    view.querySelector('#story').innerHTML = storyPath(result)
  } catch (error) {
    view.querySelector('#story').innerHTML = `<div class="note">${ICON_INFO}<span>${esc(error.message)}</span></div>`
  }
}
