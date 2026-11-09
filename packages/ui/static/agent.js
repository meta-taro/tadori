// エージェントの専用カーソル。人のマウスは使わない（奪わない）。
// エージェントは tadori のサーバーへ指示を送り（POST /api/agent）、画面はこのカーソルを動かして、ページの中で指す・押す・打つ。
// 人は自分のマウスで、同じ画面を同時に触っていてよい。
import { setWho } from './util.js'

const MOVE_MS = 650 // カーソルが動く時間（style.css の .agent-cursor の transition と合わせる）
const HIGHLIGHT_MS = 2600

/** 押せる・打てる所（ここから target の言葉で探す） */
const TARGETS = 'button, a, input, select, textarea, [role="menuitem"], [role="menuitemradio"], [role="tab"], [data-trace], tr, h1, h2, .chip, .leak-id, .rule-id'

let cursor = null
let box = null

function ensureCursor() {
  if (cursor) return
  cursor = document.createElement('div')
  cursor.className = 'agent-cursor'
  cursor.hidden = true
  cursor.setAttribute('aria-hidden', 'true')
  cursor.innerHTML = '<svg viewBox="0 0 24 24"><path d="M4 2l15 9.5-6.6 1.4L16 20.5l-3 1.3-3.5-7.6L4 18z" fill="#5e6ad2" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/></svg><span class="tag">エージェント</span>'
  document.body.appendChild(cursor)
  box = document.createElement('div')
  box.className = 'hl-box'
  box.hidden = true
  box.innerHTML = '<span class="hl-label"></span>'
  document.body.appendChild(box)
}

/** 人に見えているか（隠れた要素は押させない） */
const isVisible = el => {
  const r = el.getBoundingClientRect()
  return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'
}

/** 要素の呼び名（画面に出ている文字・読み上げ名・説明・欄の見出し） */
const namesOf = el => [
  el.getAttribute('aria-label'), el.getAttribute('title'), el.getAttribute('placeholder'),
  el.labels?.[0]?.textContent, el.textContent,
].filter(Boolean).map(s => s.replace(/\s+/g, ' ').trim())

/** target の言葉で要素を探す。ぴったり同じ名前を先に、無ければ名前に含むものを、画面の上から順に */
function findTarget(target) {
  const want = target.replace(/\s+/g, ' ').trim()
  const candidates = [...document.querySelectorAll(TARGETS)].filter(isVisible)
  return candidates.find(el => namesOf(el).some(n => n === want))
    ?? candidates.find(el => namesOf(el).some(n => n.startsWith(want)))
    ?? candidates.find(el => namesOf(el).some(n => n.includes(want)))
}

const wait = ms => new Promise(done => setTimeout(done, ms))

async function moveTo(el, message) {
  ensureCursor()
  el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  const r = el.getBoundingClientRect()
  cursor.hidden = false
  cursor.style.transform = `translate(${Math.round(r.left + Math.min(r.width / 2, 40))}px, ${Math.round(r.top + r.height / 2)}px)`
  box.hidden = false
  // 中身の列だけが動く作りなので、枠は画面に対して置く（どこが動いても、指した所に重なる）
  Object.assign(box.style, { position: 'fixed', left: `${r.left - 4}px`, top: `${r.top - 4}px`, width: `${r.width + 8}px`, height: `${r.height + 8}px` })
  box.querySelector('.hl-label').textContent = message ?? ''
  await wait(MOVE_MS)
}

/** しばらく指示が無ければ、カーソルも消す（画面に残って人の邪魔をしないように） */
const CURSOR_IDLE_MS = 6000

let hideTimer = null
let idleTimer = null
function hideLater() {
  clearTimeout(hideTimer)
  clearTimeout(idleTimer)
  hideTimer = setTimeout(() => { if (box) box.hidden = true }, HIGHLIGHT_MS)
  idleTimer = setTimeout(() => {
    if (!cursor) return
    cursor.hidden = true
    cursor.querySelector('.tag').textContent = 'エージェント'
  }, CURSOR_IDLE_MS)
}

async function say(message, el) {
  ensureCursor()
  if (el) await moveTo(el, message)
  else { cursor.hidden = false; cursor.querySelector('.tag').textContent = message }
  hideLater()
}

/** 指示を 1 つ実行する。見つからなければ、そのことを画面に出す（黙って失敗しない） */
async function run(command, toast) {
  if (command.action === 'say') return say(command.message)
  if (command.action === 'filter') {
    // 画面の担当の絞り込みを切り替え、上の帯の欄を指して見せる
    setWho(command.value)
    window.dispatchEvent(new Event('tadori-who'))
    const field = document.getElementById('who-filter')
    if (field) await moveTo(field, command.value ? `${command.value} の分だけにしました` : '全員に戻しました')
    hideLater()
    return undefined
  }
  if (command.action === 'go') {
    location.hash = command.hash
    return command.message ? say(command.message) : undefined
  }
  const el = findTarget(command.target)
  if (!el) {
    toast(`エージェント：「${command.target}」が画面に見つかりませんでした`)
    return undefined
  }
  await moveTo(el, command.message)
  if (command.action === 'click') {
    cursor.classList.remove('click'); void cursor.offsetWidth; cursor.classList.add('click')
    // ページの中で押す（人のマウスは動かさない）。mousedown も送り、メニューなどが人の操作と同じに動くようにする
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    el.click()
  }
  if (command.action === 'type') {
    el.focus()
    el.value = command.value
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }
  hideLater()
  return undefined
}

/** 指示は届いた順に 1 つずつ実行する（前の動きが終わってから次へ） */
export function initAgent(events, toast) {
  let queue = Promise.resolve()
  events.addEventListener('agent', e => {
    let command
    try { command = JSON.parse(e.data) } catch { return } // 壊れた知らせは捨てる（サーバーが検査済みの形しか流さない）
    queue = queue.then(() => run(command, toast)).catch(error => toast(`エージェントの操作に失敗しました：${error.message}`))
  })
}
