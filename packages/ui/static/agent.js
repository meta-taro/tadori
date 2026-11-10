// エージェントの専用カーソル。人のマウスは使わない（奪わない）。
// エージェントは tadori のサーバーへ指示を送り（POST /api/agent）、画面はこのカーソルを動かして、ページの中で指す・押す・打つ。
// 人は自分のマウスで、同じ画面を同時に触っていてよい。
import { t } from './i18n.js'
import { esc, messageOf, setWho } from './util.js'

const MOVE_MS = 650 // カーソルが動く時間（style.css の .agent-cursor の transition と合わせる）
/** 一言を出しておく時間：最低 5 秒＋1 文字 0.1 秒、上限 20 秒（読み切れる長さにする） */
const SHOW_MIN_MS = 5000
const SHOW_PER_CHAR_MS = 100
const SHOW_MAX_MS = 20000
/** 一言の無い強調の枠を出しておく時間 */
const HIGHLIGHT_MS = 2600
/** マウスを離したあと、消すまでの猶予 */
const AFTER_HOVER_MS = 1500

/**
 * 一言を出しておく時間。エージェントが秒数を渡せばそれを、渡さなければ文の長さで決める
 * @param {string} message @param {number} [seconds]
 */
export function showMs(message, seconds) {
  if (seconds) return seconds * 1000
  if (!message) return HIGHLIGHT_MS
  return Math.min(SHOW_MAX_MS, SHOW_MIN_MS + [...message].length * SHOW_PER_CHAR_MS)
}

/** 押せる・打てる所（ここから target の言葉で探す） */
const TARGETS = 'button, a, input, select, textarea, [role="menuitem"], [role="menuitemradio"], [role="tab"], [data-trace], tr, h1, h2, .chip, .leak-id, .rule-id'

/** @type {HTMLDivElement | null} */
let cursorEl = null
/** @type {HTMLDivElement | null} */
let boxEl = null
/** @type {HTMLDivElement | null} */
let bubbleEl = null

/**
 * カーソルと強調の枠（はじめて使うときに作る）
 * @returns {{ cursor: HTMLDivElement, box: HTMLDivElement, bubble: HTMLDivElement }}
 */
function ensureCursor() {
  if (cursorEl && boxEl && bubbleEl) return { cursor: cursorEl, box: boxEl, bubble: bubbleEl }
  const cursor = document.createElement('div')
  cursor.className = 'agent-cursor'
  cursor.hidden = true
  cursor.setAttribute('aria-hidden', 'true')
  cursor.innerHTML = '<svg viewBox="0 0 24 24"><path d="M4 2l15 9.5-6.6 1.4L16 20.5l-3 1.3-3.5-7.6L4 18z" fill="#5e6ad2" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/></svg><span class="tag">' + esc(t('Agent')) + '</span>'
  document.body.appendChild(cursor)
  const box = document.createElement('div')
  box.className = 'hl-box'
  box.hidden = true
  document.body.appendChild(box)
  // 一言の吹き出し。枠の中に入れず画面に対して置く（枠の外側のどの向きにも出せるように）
  const bubble = document.createElement('div')
  bubble.className = 'agent-bubble'
  bubble.hidden = true
  bubble.setAttribute('role', 'status')
  bubble.innerHTML = `<span class="agent-bubble-text"></span><button type="button" class="agent-bubble-close" aria-label="${esc(t('Close'))}" title="${esc(t('Close'))}">×</button>`
  // 押すと消える。マウスを乗せている間は消さない（読み終わるまで待つ）
  bubble.addEventListener('click', () => hideNow())
  bubble.addEventListener('mouseenter', () => { isHovering = true; clearTimeout(hideTimer) })
  bubble.addEventListener('mouseleave', () => { isHovering = false; hideLater(AFTER_HOVER_MS) })
  document.body.appendChild(bubble)
  cursorEl = cursor
  boxEl = box
  bubbleEl = bubble
  return { cursor, box, bubble }
}

/** 札（エージェントの名前・一言）の文字を替える */
const setTag = (/** @type {HTMLElement} */ cursor, /** @type {string} */ text) => {
  const tag = cursor.querySelector('.tag')
  if (tag) tag.textContent = text
}

/** 人に見えているか（隠れた要素は押させない） */
const isVisible = (/** @type {HTMLElement} */ el) => {
  const r = el.getBoundingClientRect()
  return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'
}

/** 要素の呼び名（画面に出ている文字・読み上げ名・説明・欄の見出し） */
const namesOf = (/** @type {HTMLElement} */ el) => [
  el.getAttribute('aria-label'), el.getAttribute('title'), el.getAttribute('placeholder'),
  // 欄の見出し（labels）は入力欄にだけある
  ('labels' in el ? /** @type {HTMLInputElement} */ (el).labels?.[0]?.textContent : undefined), el.textContent,
].filter(/** @returns {s is string} */ s => Boolean(s)).map(s => s.replace(/\s+/g, ' ').trim())

/**
 * target の言葉で要素を探す。ぴったり同じ名前を先に、無ければ名前に含むものを、画面の上から順に
 * @param {string} target
 */
function findTarget(target) {
  const want = target.replace(/\s+/g, ' ').trim()
  const candidates = [...document.querySelectorAll(TARGETS)].filter(el => el instanceof HTMLElement && isVisible(el)).map(el => /** @type {HTMLElement} */ (el))
  return candidates.find(el => namesOf(el).some(n => n === want))
    ?? candidates.find(el => namesOf(el).some(n => n.startsWith(want)))
    ?? candidates.find(el => namesOf(el).some(n => n.includes(want)))
}

const wait = (/** @type {number} */ ms) => new Promise(done => setTimeout(done, ms))

/** 吹き出しと窓の端・指した所とのすき間 */
const EDGE_PX = 8
const GAP_PX = 10
/** しっぽを吹き出しの角から離す量（角の丸みに掛からないように） */
const TAIL_INSET_PX = 14

const clamp = (/** @type {number} */ v, /** @type {number} */ lo, /** @type {number} */ hi) => Math.min(Math.max(v, lo), Math.max(lo, hi))

/**
 * 吹き出しの置き場所。地図の吹き出しのように、足りない向きを避ける：上 → 下 → 右 → 左の順に、収まる所に置き、
 * 横（上下に置くとき）・縦（左右に置くとき）は窓の中へずらす。角では結果として斜めに出る。
 * しっぽは、指した所（カーソルの位置）の向きを指す
 * @param {{ left: number, top: number, right: number, bottom: number }} target 指した所の枠
 * @param {{ x: number, y: number }} anchor カーソルの位置
 * @param {{ width: number, height: number }} size 吹き出しの大きさ
 * @param {{ width: number, height: number }} view 窓の大きさ
 * @returns {{ left: number, top: number, side: 'above' | 'below' | 'right' | 'left', tail: number }}
 */
export function bubblePlacement(target, anchor, size, view) {
  const fitsAbove = target.top - GAP_PX - size.height >= EDGE_PX
  const fitsBelow = target.bottom + GAP_PX + size.height <= view.height - EDGE_PX
  if (fitsAbove || fitsBelow) {
    const left = clamp(anchor.x - TAIL_INSET_PX, EDGE_PX, view.width - EDGE_PX - size.width)
    const top = fitsAbove ? target.top - GAP_PX - size.height : target.bottom + GAP_PX
    return { left, top, side: fitsAbove ? 'above' : 'below', tail: clamp(anchor.x - left, TAIL_INSET_PX, size.width - TAIL_INSET_PX) }
  }
  // 上下に入らない（指した所が縦に大きい）：右か左に置き、縦は窓の中へずらす
  const fitsRight = target.right + GAP_PX + size.width <= view.width - EDGE_PX
  const fitsLeft = target.left - GAP_PX - size.width >= EDGE_PX
  const top = clamp(anchor.y - size.height / 2, EDGE_PX, view.height - EDGE_PX - size.height)
  const tail = clamp(anchor.y - top, TAIL_INSET_PX, size.height - TAIL_INSET_PX)
  if (fitsRight || !fitsLeft) {
    // どこにも入らなければ、右側を窓の中へ寄せて重ねる（読めることを先にする）
    const left = clamp(target.right + GAP_PX, EDGE_PX, view.width - EDGE_PX - size.width)
    return { left, top, side: 'right', tail }
  }
  return { left: target.left - GAP_PX - size.width, top, side: 'left', tail }
}

/**
 * 吹き出しに文を入れて置く。文が無ければ隠す
 * @param {HTMLElement} bubble @param {DOMRect} r 指した所 @param {{ x: number, y: number }} anchor @param {string} message
 */
function showBubble(bubble, r, anchor, message) {
  const textEl = bubble.querySelector('.agent-bubble-text')
  if (textEl) textEl.textContent = message
  bubble.hidden = !message
  if (!message) return
  // 大きさを測ってから置く（折り返したあとの高さで、上下に入るかを決める）
  Object.assign(bubble.style, { left: '0px', top: '0px' })
  const size = bubble.getBoundingClientRect()
  const place = bubblePlacement(r, anchor, { width: size.width, height: size.height }, { width: window.innerWidth, height: window.innerHeight })
  bubble.dataset.side = place.side
  Object.assign(bubble.style, { left: `${Math.round(place.left)}px`, top: `${Math.round(place.top)}px` })
  bubble.style.setProperty('--tail', `${Math.round(place.tail)}px`)
}

/** @param {HTMLElement} el @param {string} [message] */
async function moveTo(el, message) {
  const { cursor, box, bubble } = ensureCursor()
  // 見えていないものは画面の中ほどへ寄せる（端に寄せると、札やその先の中身が隠れるため）。見えていれば動かさない
  const before = el.getBoundingClientRect()
  const isInView = before.top >= 0 && before.bottom <= window.innerHeight
  el.scrollIntoView({ block: isInView ? 'nearest' : 'center', inline: 'nearest' })
  const r = el.getBoundingClientRect()
  cursor.hidden = false
  const anchor = { x: Math.round(r.left + Math.min(r.width / 2, 40)), y: Math.round(r.top + r.height / 2) }
  cursor.style.transform = `translate(${anchor.x}px, ${anchor.y}px)`
  box.hidden = false
  // 中身の列だけが動く作りなので、枠は画面に対して置く（どこが動いても、指した所に重なる）
  Object.assign(box.style, { position: 'fixed', left: `${r.left - 4}px`, top: `${r.top - 4}px`, width: `${r.width + 8}px`, height: `${r.height + 8}px` })
  showBubble(bubble, r, anchor, message ?? '')
  await wait(MOVE_MS)
}

/** しばらく指示が無ければ、カーソルも消す（画面に残って人の邪魔をしないように） */
const CURSOR_IDLE_MS = 6000

/** @type {ReturnType<typeof setTimeout> | undefined} */
let hideTimer
/** @type {ReturnType<typeof setTimeout> | undefined} */
let idleTimer
/** 人がマウスを吹き出しに乗せているか（乗せている間は消さない） */
let isHovering = false

/** 枠と吹き出しをすぐ消す */
function hideNow() {
  clearTimeout(hideTimer)
  isHovering = false
  if (boxEl) boxEl.hidden = true
  if (bubbleEl) bubbleEl.hidden = true
}

/** @param {number} [ms] 枠と吹き出しを出しておく時間 */
function hideLater(ms = HIGHLIGHT_MS) {
  clearTimeout(hideTimer)
  clearTimeout(idleTimer)
  hideTimer = setTimeout(() => { if (!isHovering) hideNow() }, ms)
  idleTimer = setTimeout(() => {
    if (!cursorEl || isHovering) return
    cursorEl.hidden = true
    setTag(cursorEl, t('Agent'))
  }, Math.max(CURSOR_IDLE_MS, ms + 1000))
}

/** @param {string} message @param {number} [seconds] */
async function say(message, seconds) {
  const { cursor } = ensureCursor()
  cursor.hidden = false
  setTag(cursor, message)
  hideLater(showMs(message, seconds))
}

/**
 * 指示を 1 つ実行する。見つからなければ、そのことを画面に出す（黙って失敗しない）
 * @param {import('./types').AgentAction} command
 * @param {(message: string) => void} toast
 */
async function run(command, toast) {
  if (command.action === 'say') return say(command.message, command.seconds)
  if (command.action === 'filter') {
    // 画面の担当の絞り込みを切り替え、上の帯の欄を指して見せる
    setWho(command.value)
    window.dispatchEvent(new Event('tadori-who'))
    const field = document.getElementById('who-filter')
    if (field) await moveTo(field, command.value ? t('Showing only {who}', { who: command.value }) : t('Showing everyone again'))
    hideLater()
    return undefined
  }
  if (command.action === 'go') {
    location.hash = command.hash
    return command.message ? say(command.message, command.seconds) : undefined
  }
  const el = findTarget(command.target)
  if (!el) {
    toast(t('Agent: could not find "{target}" on the screen', { target: command.target }))
    return undefined
  }
  await moveTo(el, command.message)
  if (command.action === 'click') {
    const { cursor } = ensureCursor()
    cursor.classList.remove('click'); void cursor.offsetWidth; cursor.classList.add('click')
    // ページの中で押す（人のマウスは動かさない）。mousedown も送り、メニューなどが人の操作と同じに動くようにする
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    el.click()
  }
  if (command.action === 'type' && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)) {
    el.focus()
    el.value = command.value
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }
  hideLater(showMs(command.message ?? '', command.seconds))
  return undefined
}

/**
 * 指示は届いた順に 1 つずつ実行する（前の動きが終わってから次へ）
 * @param {EventSource} events
 * @param {(message: string) => void} toast
 */
export function initAgent(events, toast) {
  let queue = Promise.resolve()
  events.addEventListener('agent', (/** @type {MessageEvent<string>} */ e) => {
    /** @type {import('./types').AgentAction} */
    let command
    try { command = JSON.parse(e.data) } catch { return } // 壊れた知らせは捨てる（サーバーが検査済みの形しか流さない）
    queue = queue.then(() => run(command, toast)).catch(error => toast(t('The agent action failed: {error}', { error: messageOf(error) })))
  })
}
