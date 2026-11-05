// ルールセット・チェックの記録・つながりを辿る
import { api, chip, esc, ICON_INFO, kindLabel } from './util.js'
import { renderPicker } from './trace-picker.js'

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
  // 切れ目として出す漏れは、カードに重ねて出さない（列が空など、つながり以外の漏れだけをカードに出す）
  const shownAsGap = new Set(result.steps.flatMap(s => (s.type === 'missing' ? [`${s.rule}:${s.after ?? s.before}`] : [])))
  const parts = []
  result.steps.forEach((s, i) => {
    const prev = result.steps[i - 1]
    // 切れ目の前後の線を赤くする（上流が無い切れ目は、その後ろの線、下流が無い切れ目は前の線）
    const broken = s.type === 'missing' || prev?.type === 'missing'
    if (i > 0) parts.push(`<div class="sp-link ${broken ? 'broken' : ''}"><span class="sp-line"></span><span class="sp-link-label">${s.type === 'missing' ? 'ここで切れている' : ''}</span></div>`)
    if (s.type === 'missing') {
      const what = s.before ? `元にした${kindLabel(s.kind)}が無い` : `${kindLabel(s.kind)}が無い`
      parts.push(`<div class="sp-card ng"><div class="sp-phase">${esc(s.rule)}</div><div class="sp-icon">${ICON_NG}</div>
        <div class="sp-kind">${esc(kindLabel(s.kind))}</div><div class="sp-say">${esc(what)}</div><div class="sp-src">台帳に ${esc(s.kind)} の行が無い</div></div>`)
      return
    }
    const isStart = s.item.id === result.start.id
    const other = (s.leaks ?? []).filter(l => !shownAsGap.has(`${l.rule}:${l.itemId}`))
    const leakHtml = other.map(l => `<div class="sp-leak">漏れ ${esc(l.rule)}：${esc(l.message)}</div>`).join('')
    parts.push(`<div class="sp-card ${other.length ? 'ng' : 'ok'} ${isStart ? 'end' : ''}"><div class="sp-phase">${isStart ? '辿り始め' : ''}</div><div class="sp-icon">${other.length ? ICON_NG : ICON_OK}</div>
      <div class="sp-kind">${esc(kindLabel(s.item.kind))} <span class="mono">${esc(s.item.id)}</span></div>
      <div class="sp-say">${esc(s.item.title)}</div>${leakHtml}<div class="sp-src">${esc(s.item.source)}</div></div>`)
  })
  return parts.join('')
}

export async function renderTrace(view, state, startId) {
  const start = state.items.find(i => i.id === startId)
  view.innerHTML = `
    <h1>つながりを辿る</h1>
    <p class="lede">台帳の 1 行（指摘・試験ケース・設計書の章など）から、上流と下流のつながりを工程の順に並べます。
      つながりは台帳に書かれた ID だけで tadori が判定し、推測でつなぎません。切れている所が赤です。</p>
    <div class="trace-layout">
      <section aria-label="どこから辿る"><h2>どこから辿る</h2><div id="picker"></div></section>
      <section aria-label="辿った結果">
        <h2>${start ? `${esc(start.id)}「${esc(start.title)}」から辿った結果` : '辿った結果'}</h2>
        <div class="story-path" id="story" role="list"><div class="cond">${startId ? '読み込み中…' : '左で辿り始めの行を選んでください'}</div></div>
        <div class="verdict"><span>この線のどこが漏れていたかを決めるのは人です。確かめたら、チェックの記録に人の行として残してください。</span></div>
      </section>
    </div>`
  renderPicker(view.querySelector('#picker'), state, startId, id => { location.hash = `trace-${encodeURIComponent(id)}` })
  if (!startId) return
  try {
    const result = await api(`/api/trace/${encodeURIComponent(startId)}`)
    view.querySelector('#story').innerHTML = storyPath(result)
  } catch (error) {
    view.querySelector('#story').innerHTML = `<div class="note">${ICON_INFO}<span>${esc(error.message)}</span></div>`
  }
}
