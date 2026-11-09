// 明るい／暗い配色を、画面を描く前に決める（チラつかないよう、ふつうの script として head で読む）。
// 選んだものは手元のブラウザに覚える。既定は明るい配色（会議で画面を共有する職場が多いため）
;(function () {
  var KEY = 'tadori-theme'
  var CHOICES = ['light', 'dark', 'system']
  var media = window.matchMedia('(prefers-color-scheme: dark)')

  /** @returns {string} */
  function choice() {
    var saved = ''
    try { saved = localStorage.getItem(KEY) || '' } catch (e) { /* 覚えられない環境では既定のまま */ }
    return CHOICES.indexOf(saved) >= 0 ? saved : 'light'
  }
  function apply() {
    var c = choice()
    var dark = c === 'dark' || (c === 'system' && media.matches)
    if (dark) document.documentElement.setAttribute('data-theme', 'dark')
    else document.documentElement.removeAttribute('data-theme')
  }
  function set(value) {
    if (CHOICES.indexOf(value) < 0) return
    try { localStorage.setItem(KEY, value) } catch (e) { /* 覚えられなくても、いまの画面には効かせる */ }
    apply()
  }
  media.addEventListener('change', apply)
  apply()
  window.tadoriTheme = { choice: choice, set: set }
})()
