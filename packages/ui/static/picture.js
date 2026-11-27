/**
 * 画面の一部（または全体）を PNG の画像にする。エージェントが見た目（マーカー・下線・行の崩れ・余白）を確かめるため。
 * 部品を足さずに、計算済みの見た目（computed style）を写した複製を SVG の foreignObject に入れて canvas に描く。
 * 疑似要素（::before など）と外の画像は写らない。字形は手元に入っている字体で描く
 */

/** 画像の長い辺の上限（大きすぎる画像は送れないため） */
const MAX_SIDE_PX = 4000

/**
 * @param {Element} root 撮る所
 * @returns {Promise<string>} PNG の data URL
 */
export async function pictureOf(root) {
  const rect = root.getBoundingClientRect()
  const width = Math.max(1, Math.ceil(Math.max(rect.width, root.scrollWidth)))
  const height = Math.max(1, Math.ceil(Math.max(rect.height, root.scrollHeight)))
  const copy = cloneWithStyle(root)
  if (copy instanceof HTMLElement) {
    // 撮る所の外の位置・高さの決めごとは外し、中身の大きさで描く
    copy.style.margin = '0'
    copy.style.position = 'static'
    copy.style.height = `${height}px`
    copy.style.maxHeight = 'none'
    copy.style.overflow = 'visible'
  }
  const background = getComputedStyle(document.body).backgroundColor || '#fff'
  const html = new XMLSerializer().serializeToString(copy)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><foreignObject x="0" y="0" width="100%" height="100%">`
    + `<div xmlns="http://www.w3.org/1999/xhtml" style="background:${background};width:${width}px;height:${height}px">${html}</div></foreignObject></svg>`
  const image = new Image()
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  await image.decode()
  const scale = Math.min(window.devicePixelRatio || 1, 2, MAX_SIDE_PX / Math.max(width, height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(width * scale)
  canvas.height = Math.round(height * scale)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('canvas is not available')
  context.scale(scale, scale)
  context.drawImage(image, 0, 0)
  return canvas.toDataURL('image/png')
}

/**
 * 要素を、計算済みの見た目を style に書き写して複製する（欄の値も写す）。script は写さない
 * @param {Node} node
 * @returns {Node}
 */
function cloneWithStyle(node) {
  if (node.nodeType === Node.TEXT_NODE) return node.cloneNode(false)
  if (!(node instanceof Element) || node instanceof HTMLScriptElement) return document.createTextNode('')
  const copy = /** @type {Element} */ (node.cloneNode(false))
  const style = getComputedStyle(node)
  let css = ''
  for (let i = 0; i < style.length; i += 1) {
    const name = style.item(i)
    css += `${name}:${style.getPropertyValue(name)};`
  }
  copy.setAttribute('style', css)
  copy.removeAttribute('id')
  if (node instanceof HTMLInputElement) {
    if (node.type === 'checkbox' || node.type === 'radio') { if (node.checked) copy.setAttribute('checked', '') } else copy.setAttribute('value', node.value)
  }
  if (node instanceof HTMLTextAreaElement) {
    copy.textContent = node.value
    return copy
  }
  for (const child of node.childNodes) copy.appendChild(cloneWithStyle(child))
  if (node instanceof HTMLSelectElement) {
    const selected = node.selectedIndex
    copy.querySelectorAll('option').forEach((option, i) => { if (i === selected) option.setAttribute('selected', '') })
  }
  return copy
}
