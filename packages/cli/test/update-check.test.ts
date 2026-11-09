import { describe, expect, test } from 'vitest'
import { checkUpdate, isNewer } from '../src/update-check.js'

// GitHub の「最新のリリース」の返事を真似る（本物には繋がない）
const release = (tag: string) => async () => new Response(JSON.stringify({ tag_name: tag, html_url: `https://github.com/meta-taro/tadori/releases/tag/${tag}` }), { status: 200 })

describe('isNewer（版の比べ方）', () => {
  test('数字ごとに比べる。頭の v は無視する', () => {
    expect(isNewer('v0.2.0', '0.1.0')).toBe(true)
    expect(isNewer('0.1.10', '0.1.9')).toBe(true)
    expect(isNewer('v0.1.0', '0.1.0')).toBe(false)
    expect(isNewer('0.0.9', '0.1.0')).toBe(false)
  })
})

describe('checkUpdate（新しい版があるか）', () => {
  test('新しい版があれば、その版と配布のページを返す', async () => {
    expect(await checkUpdate('0.1.0', release('v0.2.0'))).toEqual({
      current: '0.1.0', latest: '0.2.0', isNewer: true,
      releaseUrl: 'https://github.com/meta-taro/tadori/releases/tag/v0.2.0',
      downloadUrl: 'https://meta-taro.github.io/tadori/download.html',
    })
    expect((await checkUpdate('0.2.0', release('v0.2.0'))).isNewer).toBe(false)
  })

  test('繋がらない・おかしな返事は、誤りとして返す（黙って「最新」と言わない）', async () => {
    await expect(checkUpdate('0.1.0', async () => { throw new Error('offline') })).rejects.toThrow(/確かめられません/)
    await expect(checkUpdate('0.1.0', async () => new Response('x', { status: 500 }))).rejects.toThrow(/確かめられません/)
    await expect(checkUpdate('0.1.0', async () => new Response('{}', { status: 200 }))).rejects.toThrow(/確かめられません/)
  })
})
