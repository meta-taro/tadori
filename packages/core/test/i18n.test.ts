import { describe, expect, test } from 'vitest'
import { currentLang, detectLang, langOf, t, withLang } from '../src/i18n.js'

describe('tadori が出す言葉の言語', () => {
  test('TADORI_LANG → OS の言語（LC_ALL・LANG）→ 英語の順で決める', () => {
    expect(detectLang({ TADORI_LANG: 'ja' })).toBe('ja')
    expect(detectLang({ TADORI_LANG: 'en', LANG: 'ja_JP.UTF-8' })).toBe('en')
    expect(detectLang({ LANG: 'ja_JP.UTF-8' })).toBe('ja')
    expect(langOf('fr-FR')).toBeUndefined()
  })

  test('頼みの間だけ言語を替えられる。辞書に無い文は英語のまま、{名前} を埋める', () => {
    withLang('en', () => {
      expect(currentLang()).toBe('en')
      expect(t('{id} is missing', { id: 'X-1' })).toBe('X-1 is missing')
    })
    withLang('ja', () => expect(currentLang()).toBe('ja'))
  })
})
