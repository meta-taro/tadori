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

describe('parseAgentAction の seconds（吹き出しを出しておく秒数）', () => {
  test('秒数を渡せば、その秒数を指示に付ける。渡さなければ付けない（画面が文の長さで決める）', () => {
    expect(parseAgentAction({ action: 'point', target: 'ファイル', message: '見てください', seconds: 12 })).toEqual({ action: 'point', target: 'ファイル', message: '見てください', seconds: 12 })
    expect(parseAgentAction({ action: 'say', message: 'こんにちは' })).not.toHaveProperty('seconds')
  })

  test('秒数は 1〜60 の数だけ受ける', () => {
    expect(() => parseAgentAction({ action: 'say', message: 'x', seconds: 0 })).toThrow(/seconds/)
    expect(() => parseAgentAction({ action: 'say', message: 'x', seconds: 61 })).toThrow(/seconds/)
    expect(() => parseAgentAction({ action: 'say', message: 'x', seconds: '5' })).toThrow(/seconds/)
  })
})

describe('parseAgentAction の filter（画面の人の絞り込みを切り替える）', () => {
  test('人の名前で絞る。空なら全員に戻す', () => {
    expect(parseAgentAction({ action: 'filter', value: '設計担当A' })).toEqual({ action: 'filter', value: '設計担当A' })
    expect(parseAgentAction({ action: 'filter', value: '' })).toEqual({ action: 'filter', value: '' })
  })
})
