// 設定：工程とステータス。保存すると TSV に書き戻し、案件が git リポジトリなら commit する
import { api, ApiError, chip, esc, ICON_INFO, messageOf, toast, toastCommit } from './util.js'

const TONES = { none: '色なし', wait: '青灰（途中）', hole: '琥珀（止まっている）', ok: '緑（済み）' }
let problems = []

/** 見た目の選び方。案件の設定ではなく、この PC のこの人の好みなので TSV には書かない（theme.js が覚える） */
const THEMES = { light: 'ライト', dark: 'ダーク', system: 'OS に合わせる' }

function themeHtml() {
  const current = window.tadoriTheme?.choice() ?? 'light'
  return `<h2>見た目</h2>
    <div class="seg" role="group" aria-label="配色">${Object.entries(THEMES).map(([k, v]) =>
      `<button type="button" data-theme-choice="${k}" aria-pressed="${k === current}">${v}</button>`).join('')}</div>
    <p class="cond">この PC で開く tadori だけに効きます（案件の設定には書きません）。</p>`
}

/** 一覧の行を並べ替える（元の配列は変えない） */
const moved = (list, index, dir) => {
  const next = [...list]
  const target = index + dir
  if (target < 0 || target >= next.length) return next
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
}

async function save(path, body, what, reload) {
  try {
    const { commit } = await api(path, { method: 'PUT', body })
    problems = []
    toastCommit(what, commit)
    await reload()
  } catch (error) {
    problems = error instanceof ApiError && error.problems.length ? error.problems : [messageOf(error)]
    toast(`${what}を保存できませんでした`)
    await reload()
  }
}

function phaseRows(state) {
  const used = id => [...state.rules.filter(r => r.phase === id).map(r => r.id), ...state.tasks.filter(t => t.phase === id).map(t => t.id)]
  return state.phases.map((p, i) => `<tr>
    <td class="rule-id">${i + 1}</td>
    <td><input class="inline-input" data-phase-name="${esc(p.id)}" value="${esc(p.name)}" aria-label="工程 ${esc(p.id)} の名前"></td>
    <td class="mono src">${esc(p.id)}</td>
    <td class="cond">${used(p.id).length ? `${used(p.id).length} 件（${esc(used(p.id).slice(0, 4).join('・'))}${used(p.id).length > 4 ? '…' : ''}）` : '使われていない'}</td>
    <td class="row-actions">
      <button type="button" class="btn-ghost" data-phase-move="${i}" data-dir="-1" ${i === 0 ? 'disabled' : ''} aria-label="上へ">↑</button>
      <button type="button" class="btn-ghost" data-phase-move="${i}" data-dir="1" ${i === state.phases.length - 1 ? 'disabled' : ''} aria-label="下へ">↓</button>
      <button type="button" class="btn-ghost" data-phase-remove="${esc(p.id)}">消す</button>
    </td></tr>`).join('')
}

function statusRows(state) {
  const toneOptions = cur => Object.entries(TONES).map(([k, v]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${v}</option>`).join('')
  return state.statuses.map((s, i) => `<tr>
    <td class="rule-id">${i + 1}</td>
    <td>${chip(s.tone === 'none' ? '' : s.tone, esc(s.name))}</td>
    <td><select class="inline-select" data-status-tone="${esc(s.id)}" aria-label="${esc(s.name)} の色">${toneOptions(s.tone)}</select></td>
    <td class="cond">${state.tasks.filter(t => t.status === s.id).length} 件</td>
    <td class="row-actions">
      <button type="button" class="btn-ghost" data-status-move="${i}" data-dir="-1" ${i === 0 ? 'disabled' : ''} aria-label="上へ">↑</button>
      <button type="button" class="btn-ghost" data-status-move="${i}" data-dir="1" ${i === state.statuses.length - 1 ? 'disabled' : ''} aria-label="下へ">↓</button>
      <button type="button" class="btn-ghost" data-status-remove="${esc(s.id)}">消す</button>
    </td></tr>`).join('')
}

export function renderSettings(view, state, reload) {
  view.innerHTML = `
    <h1>設定</h1>
    <p class="lede">工程の並びとステータスは、企業やプロダクトごとに違います。保存すると <span class="mono">.tadori/</span> の TSV に書き戻し、案件が git リポジトリなら commit します（push は人が確かめてから）。</p>
    ${problems.length ? `<div class="note">${ICON_INFO}<span>${problems.map(esc).join('<br>')}</span></div>` : ''}
    ${themeHtml()}
    <h2>工程 · ${state.phases.length} 件</h2>
    <div class="panel"><table>
      <thead><tr><th style="width:48px">順</th><th>名前</th><th style="width:90px">ID</th><th>使っているルール・タスク</th><th style="width:170px"></th></tr></thead>
      <tbody>${phaseRows(state)}</tbody></table>
      <form class="add" id="add-phase">
        <label>ID（英数字）<input name="id" required pattern="[A-Za-z0-9_-]+" placeholder="例：st"></label>
        <label>名前<input name="name" required maxlength="20" placeholder="例：総合テスト"></label>
        <div class="actions"><button type="submit" class="btn-primary">工程を足す</button></div>
      </form></div>
    <h2>WBS のステータス · ${state.statuses.length} 件</h2>
    <div class="panel"><table>
      <thead><tr><th style="width:48px">順</th><th>名前</th><th style="width:200px">色の意味</th><th style="width:96px">使っているタスク</th><th style="width:170px"></th></tr></thead>
      <tbody>${statusRows(state)}</tbody></table>
      <form class="add" id="add-status">
        <label>ID（英数字）<input name="id" required pattern="[A-Za-z0-9_-]+" placeholder="例：back"></label>
        <label>名前<input name="name" required maxlength="20" placeholder="例：差し戻し"></label>
        <label>色の意味<select name="tone">${Object.entries(TONES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
        <div class="actions"><button type="submit" class="btn-primary">ステータスを足す</button></div>
      </form></div>`

  view.querySelectorAll('[data-theme-choice]').forEach(b => b.addEventListener('click', () => {
    window.tadoriTheme?.set(b.dataset.themeChoice)
    view.querySelectorAll('[data-theme-choice]').forEach(x => x.setAttribute('aria-pressed', String(x === b)))
  }))

  const savePhases = list => save('/api/settings/phases', list.map((p, i) => ({ ...p, order: i + 1 })), '工程の設定', reload)
  const saveStatuses = list => save('/api/settings/statuses', list, 'ステータスの設定', reload)

  view.querySelectorAll('[data-phase-name]').forEach(input => input.addEventListener('change', () =>
    savePhases(state.phases.map(p => (p.id === input.dataset.phaseName ? { ...p, name: input.value.trim() } : p)))))
  view.querySelectorAll('[data-phase-move]').forEach(b => b.addEventListener('click', () =>
    savePhases(moved(state.phases, Number(b.dataset.phaseMove), Number(b.dataset.dir)))))
  view.querySelectorAll('[data-phase-remove]').forEach(b => b.addEventListener('click', () =>
    savePhases(state.phases.filter(p => p.id !== b.dataset.phaseRemove))))
  view.querySelector('#add-phase').addEventListener('submit', e => {
    e.preventDefault()
    const f = new FormData(e.target)
    savePhases([...state.phases, { id: String(f.get('id')).trim(), name: String(f.get('name')).trim(), order: 0 }])
  })

  view.querySelectorAll('[data-status-tone]').forEach(sel => sel.addEventListener('change', () =>
    saveStatuses(state.statuses.map(s => (s.id === sel.dataset.statusTone ? { ...s, tone: sel.value } : s)))))
  view.querySelectorAll('[data-status-move]').forEach(b => b.addEventListener('click', () =>
    saveStatuses(moved(state.statuses, Number(b.dataset.statusMove), Number(b.dataset.dir)))))
  view.querySelectorAll('[data-status-remove]').forEach(b => b.addEventListener('click', () =>
    saveStatuses(state.statuses.filter(s => s.id !== b.dataset.statusRemove))))
  view.querySelector('#add-status').addEventListener('submit', e => {
    e.preventDefault()
    const f = new FormData(e.target)
    saveStatuses([...state.statuses, { id: String(f.get('id')).trim(), name: String(f.get('name')).trim(), tone: String(f.get('tone')) }])
  })
}
