// チェックの記録・つながりを辿る
import { api, chip, esc, ICON_INFO, kindLabel, toast } from './util.js'
import { renderPicker } from './trace-picker.js'

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

function storyPath(result, resolved = []) {
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
      parts.push(`<div class="sp-card ng"><div class="sp-phase"><span class="leak-id">${esc(s.rule)}·${esc(s.after ?? s.before)}</span></div><div class="sp-icon">${ICON_NG}</div>
        <div class="sp-kind">${esc(kindLabel(s.kind))}</div><div class="sp-say">${esc(what)}</div><div class="sp-src">台帳に ${esc(s.kind)} の行が無い</div></div>`)
      return
    }
    const isStart = s.item.id === result.start.id
    const other = (s.leaks ?? []).filter(l => !shownAsGap.has(`${l.rule}:${l.itemId}`))
    const leakHtml = other.map(l => `<div class="sp-leak">漏れ <b>${esc(l.rule)}·${esc(l.itemId)}</b>：${esc(l.message)}</div>`).join('')
    // 前のチェックでは漏れだったが、いまは満たす行（チェックの記録から読む）
    const was = resolved.find(r => r.itemId === s.item.id)
    // カードは 3 つ：いまも漏れ（ng）／前は漏れで、いまは満たす（resolved）／初めから漏れなし（ok）
    // 漏れが切れ目として出ている行も、その行自身の漏れなので「漏れ」にする（中身は切れ目のカードに書く）
    const card = (s.leaks ?? []).length ? 'ng' : was ? 'resolved' : 'ok'
    const resolvedHtml = card === 'resolved' && was ? `<div class="sp-resolved">${esc(was.when.slice(5, 10).replace('-', '/'))} のチェックでは漏れ（${esc(was.rule)}）→ いまは満たす</div>` : ''
    const badge = { ng: '<span class="sp-badge ng">漏れ</span>', resolved: '<span class="sp-badge resolved">対応済み</span>', ok: '<span class="sp-badge ok">漏れなし</span>' }[card]
    const icon = { ng: ICON_NG, resolved: `<span class="sp-flip">${ICON_NG}<span>→</span>${ICON_OK}</span>`, ok: ICON_OK }[card]
    parts.push(`<div class="sp-card ${card === 'ng' && !other.length ? 'ng-gap' : card} ${isStart ? 'end' : ''}"><div class="sp-phase">${isStart ? '辿り始め' : ''}${badge}</div><div class="sp-icon">${icon}</div>
      <div class="sp-kind">${esc(kindLabel(s.item.kind))} <span class="mono">${esc(s.item.id)}</span></div>
      <div class="sp-say">${esc(s.item.title)}</div>${leakHtml}${resolvedHtml}<div class="sp-src">${esc(s.item.source)}</div></div>`)
  })
  return parts.join('')
}

/** 図の上の 1 行：この線の上の漏れと対応済みが、どの行のものかを並べる */
function traceSummary(result, resolved) {
  const leakIds = new Set()
  for (const s of result.steps) {
    if (s.type === 'missing') leakIds.add(s.after ?? s.before)
    else if ((s.leaks ?? []).length) leakIds.add(s.item.id)
  }
  const onLine = new Set(result.steps.filter(s => s.type === 'item').map(s => s.item.id))
  const done = resolved.filter(r => onLine.has(r.itemId) && !leakIds.has(r.itemId)).map(r => r.itemId)
  const parts = [
    leakIds.size ? `<span class="chip hole"><span class="dot"></span>漏れ ${leakIds.size} 件（${[...leakIds].map(esc).join('・')}）</span>` : '<span class="chip ok"><span class="dot"></span>この線の上に漏れはありません</span>',
    done.length ? `<span class="chip ok"><span class="dot"></span>対応済み ${done.length} 件（${done.map(esc).join('・')}）</span>` : '',
  ]
  return `<div class="trace-summary"><span class="cond">この線の上：</span>${parts.join('')}</div>`
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
        <div class="trace-head"><h2>${start ? `<span class="big-id">${esc(start.id)}</span>「${esc(start.title)}」から辿った結果` : '辿った結果'}</h2>${start ? '<button type="button" class="btn-ghost" id="copy-link" title="この結果を開くリンク（会議で渡すとき）">リンクをコピー</button>' : ''}</div>
        <div id="trace-summary"></div>
        <div class="story-path" id="story" role="list"><div class="cond">${startId ? '読み込み中…' : '左で辿り始めの行を選んでください'}</div></div>
        <div class="verdict"><span>この線のどこが漏れていたかを決めるのは人です。確かめたら、チェックの記録に人の行として残してください。</span></div>
      </section>
    </div>`
  renderPicker(view.querySelector('#picker'), state, startId, id => { location.hash = `trace-${encodeURIComponent(id)}` })
  if (!startId) return
  // リンクをコピー：クリックの中でだけ書き込める。断られたら URL を知らせる
  view.querySelector('#copy-link')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(location.href)
      toast(`リンクをコピーしました：${location.href}`)
    } catch {
      toast(`コピーできませんでした。アドレスバーの URL を渡してください：${location.href}`)
    }
  })
  try {
    const result = await api(`/api/trace/${encodeURIComponent(startId)}`)
    view.querySelector('#story').innerHTML = storyPath(result, state.resolved ?? [])
    view.querySelector('#trace-summary').innerHTML = traceSummary(result, state.resolved ?? [])
  } catch (error) {
    view.querySelector('#story').innerHTML = `<div class="note">${ICON_INFO}<span>${esc(error.message)}</span></div>`
  }
}
