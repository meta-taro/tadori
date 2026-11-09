// 画面の上の検索：打っている途中から、どの画面のどこに出てくるかをグループに分けて並べる
import { byId, esc, kindLabel } from './util.js'

const PER_GROUP = 5
/** @type {Array<Record<string, string>> | null} 用語集は最初に検索したときに 1 回だけ読む */
let glossary = null

async function loadGlossary() {
  if (glossary) return glossary
  try {
    const text = await (await fetch('/glossary.tsv')).text()
    const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim() && !l.startsWith('#'))
    const header = (lines.shift() ?? '').split('\t')
    glossary = lines.map(line => Object.fromEntries(header.map((h, i) => [h, line.split('\t')[i] ?? ''])))
  } catch {
    glossary = [] // 用語集が読めなくても、ほかの検索は動かす
  }
  return glossary
}

/** 検索の対象を作る。open は選ばれたときの動き（画面を移す・絞り込みを入れる） */
export function buildIndex(state, terms) {
  const phaseName = id => state.phases.find(p => p.id === id)?.name ?? ''
  const ruleOf = id => state.rules.find(r => r.id === id)
  const taskIds = new Set(state.tasks.map(t => t.id))
  return [
    ...state.tasks.map(t => ({
      group: 'タスク', id: t.id, title: t.name, where: `プロダクト（WBS）· ${phaseName(t.phase)}`,
      text: `${t.id} ${t.name}`, open: { hash: `browse-${t.id}` },
    })),
    ...state.items.filter(i => !taskIds.has(i.id)).map(i => ({
      group: '台帳の行', id: i.id, title: i.title, where: `つながりを辿る · ${kindLabel(i.kind)}`,
      text: `${i.id} ${i.title}`, open: { hash: `trace-${i.id}` },
    })),
    ...state.leaks.map(l => {
      const phase = ruleOf(l.rule)?.phase ?? ''
      return {
        group: '漏れ', id: `${l.rule}·${l.itemId}`, title: l.message, where: `リリースまでの残課題 · ${phaseName(phase) || 'どの工程にも属さない'}`,
        text: `${l.rule}·${l.itemId} ${l.rule} ${l.itemId} ${l.message}`, open: { hash: phase ? `phases-${phase}` : 'phases' },
      }
    }),
    ...state.rules.map(r => ({
      group: 'ルール', id: r.id, title: r.label, where: `ルールセット · ${phaseName(r.phase)}`,
      text: `${r.id} ${r.label}`, open: { hash: 'rules', query: { view: 'rules', value: r.id } },
    })),
    ...state.checks.map((c, i) => ({
      group: 'チェックの記録', id: c.when, title: `${c.who}：${c.what} → ${c.result}`, where: 'チェックの記録',
      text: `${c.when} ${c.who} ${c.what} ${c.why} ${c.result}`, open: { hash: 'log' }, key: `check-${i}`,
    })),
    ...terms.map(g => ({
      group: '用語', id: g.term, title: g.meaning, where: `用語 · ${g.group}`,
      text: `${g.term} ${g.meaning}`, open: { hash: 'glossary', query: { view: 'glossary', value: g.term } },
    })),
  ]
}

/** 打った言葉を全部含むものを、グループごとに PER_GROUP 件まで。ID が丸ごと一致したものを先頭に */
export function searchIndex(index, raw) {
  const words = raw.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return []
  const hits = index.filter(e => words.every(w => e.text.toLowerCase().includes(w)))
  const exact = raw.trim().toLowerCase()
  hits.sort((a, b) => Number(b.id.toLowerCase() === exact) - Number(a.id.toLowerCase() === exact))
  const groups = [...new Set(hits.map(h => h.group))]
  return groups.map(g => ({ group: g, total: hits.filter(h => h.group === g).length, entries: hits.filter(h => h.group === g).slice(0, PER_GROUP) }))
}

/** 合った言葉に印を付ける（先にエスケープしてから印を付けるので、文字が HTML として働くことはない） */
function mark(text, raw) {
  let html = esc(text)
  for (const w of raw.trim().split(/\s+/).filter(Boolean)) {
    const escaped = esc(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    html = html.replace(new RegExp(escaped, 'gi'), m => `<mark>${m}</mark>`)
  }
  return html
}

/**
 * 検索の欄を動かす。getState で最新の案件を読み、navigate(open) で画面を移す。
 */
export function initSearch({ getState, navigate }) {
  const form = byId('jump')
  const input = /** @type {HTMLInputElement} */ (byId('jump-input'))
  const panel = document.createElement('div')
  panel.className = 'search-panel'
  panel.setAttribute('role', 'listbox')
  panel.hidden = true
  form.appendChild(panel)
  let flat = []
  let active = 0

  const close = () => { panel.hidden = true; flat = [] }
  const choose = entry => { if (!entry) return; close(); input.value = ''; input.blur(); navigate(entry.open) }

  const draw = async () => {
    const state = getState()
    if (!state || !input.value.trim()) { close(); return }
    const results = searchIndex(buildIndex(state, await loadGlossary()), input.value)
    flat = results.flatMap(g => g.entries)
    active = 0
    if (!flat.length) {
      panel.innerHTML = `<div class="search-empty">「${esc(input.value.trim())}」はどの画面にもありません</div>`
      panel.hidden = false
      return
    }
    let n = -1
    panel.innerHTML = results.map(g => `
      <div class="search-group"><span>${esc(g.group)}</span><span class="pick-count">${g.total > g.entries.length ? `${g.entries.length} / ${g.total} 件` : `${g.total} 件`}</span></div>
      ${g.entries.map(e => { n += 1; return `<button type="button" class="search-row ${n === 0 ? 'on' : ''}" role="option" data-n="${n}">
        <span class="search-id mono">${mark(e.id, input.value)}</span>
        <span class="search-title">${mark(e.title, input.value)}</span>
        <span class="search-where">${esc(e.where)}</span>
      </button>` }).join('')}`).join('')
    panel.hidden = false
    panel.querySelectorAll('[data-n]').forEach(b => b.addEventListener('mousedown', ev => { ev.preventDefault(); choose(flat[Number(/** @type {HTMLElement} */ (b).dataset.n)]) }))
  }

  const highlight = () => panel.querySelectorAll('[data-n]').forEach(b => {
    const on = Number(/** @type {HTMLElement} */ (b).dataset.n) === active
    b.classList.toggle('on', on)
    if (on) b.scrollIntoView({ block: 'nearest' })
  })

  input.addEventListener('input', draw)
  input.addEventListener('focus', draw)
  input.addEventListener('blur', () => setTimeout(close, 150))
  input.addEventListener('keydown', e => {
    if (e.key === 'Escape') { close(); input.blur(); return }
    if (!flat.length) return
    if (e.key === 'ArrowDown') { e.preventDefault(); active = (active + 1) % flat.length; highlight() }
    if (e.key === 'ArrowUp') { e.preventDefault(); active = (active - 1 + flat.length) % flat.length; highlight() }
  })
  form.addEventListener('submit', e => { e.preventDefault(); choose(flat[active]) })
  // 「/」で検索の欄へ（文字を打っている途中は横取りしない）
  document.addEventListener('keydown', e => {
    const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName ?? '')
    if (e.key === '/' && !typing) { e.preventDefault(); input.focus() }
  })
}
