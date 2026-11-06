import { describe, expect, test } from 'vitest'
import { parseAgentAction } from '../src/agent.js'

describe('parseAgentAction（エージェントが画面の中の専用カーソルで操作する指示）', () => {
  test('指す・押す・打つ・移る・話す、を受ける', () => {
    expect(parseAgentAction({ action: 'point', target: 'ファイル' })).toEqual({ action: 'point', target: 'ファイル' })
    expect(parseAgentAction({ action: 'click', target: 'ルールセット', message: 'ルールを見ます' })).toEqual({ action: 'click', target: 'ルールセット', message: 'ルールを見ます' })
    expect(parseAgentAction({ action: 'type', target: '探す', value: 'DD-2.3' })).toEqual({ action: 'type', target: '探す', value: 'DD-2.3' })
    expect(parseAgentAction({ action: 'go', hash: '#rules' })).toEqual({ action: 'go', hash: '#rules' })
    expect(parseAgentAction({ action: 'say', message: 'ここが漏れです' })).toEqual({ action: 'say', message: 'ここが漏れです' })
  })

  test('知らない動きや、押す先の無い指示は断る（理由つき）', () => {
    expect(() => parseAgentAction({ action: 'drag', target: 'x' })).toThrow(/動き/)
    expect(() => parseAgentAction({ action: 'click' })).toThrow(/target/)
    expect(() => parseAgentAction({ action: 'type', target: '探す' })).toThrow(/value/)
    expect(() => parseAgentAction('click')).toThrow()
  })

  test('画面の中の移動先は # で始まるものだけ（外のページへは移らせない）', () => {
    expect(() => parseAgentAction({ action: 'go', hash: 'https://example.com/' })).toThrow(/#/)
  })

  test('長すぎる文字は断る', () => {
    expect(() => parseAgentAction({ action: 'say', message: 'あ'.repeat(501) })).toThrow(/長/)
  })
})
