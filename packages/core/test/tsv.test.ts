import { describe, expect, test } from 'vitest'
import { parseTsv, updateCell } from '../src/infrastructure/tsv.js'

describe('parseTsv', () => {
  test('1 行目を見出しにして、行を列名つきで返す', () => {
    const { header, rows } = parseTsv('id\tname\nA\t甲\nB\t乙\n')
    expect(header).toEqual(['id', 'name'])
    expect(rows).toEqual([{ id: 'A', name: '甲' }, { id: 'B', name: '乙' }])
  })

  test('# で始まる行と空行は読み飛ばす', () => {
    const { rows } = parseTsv('# 説明\nid\tname\n\n# 途中の説明\nA\t甲\n')
    expect(rows).toEqual([{ id: 'A', name: '甲' }])
  })

  test('CRLF の改行も読める（md-business の検証シートは CRLF）', () => {
    const { rows } = parseTsv('id\tname\r\nA\t甲\r\n')
    expect(rows).toEqual([{ id: 'A', name: '甲' }])
  })

  test('足りない列は空文字にする（空のセルは空のまま）', () => {
    const { rows } = parseTsv('id\tname\tnote\nA\t甲\n')
    expect(rows).toEqual([{ id: 'A', name: '甲', note: '' }])
  })

  test('updateCell：1 つのセルだけ書き換え、ほかの行・# の行・列の並びはそのまま残す', () => {
    const text = '# 説明\nid\tname\tstatus\nA\t甲\ttodo\nB\t乙\ttodo\n'
    expect(updateCell(text, 'id', 'B', 'status', 'done')).toBe('# 説明\nid\tname\tstatus\nA\t甲\ttodo\nB\t乙\tdone\n')
  })

  test('updateCell：対象の行が無ければ null を返す', () => {
    expect(updateCell('id\tstatus\nA\ttodo\n', 'id', 'Z', 'status', 'done')).toBeNull()
  })

  test('先頭の BOM（表計算やメモ帳で保存したとき）を読み飛ばす', () => {
    expect(parseTsv('﻿id\tname\nA\t甲\n').rows).toEqual([{ id: 'A', name: '甲' }])
  })

  test('updateCell：BOM のあるファイルも書き換えられ、BOM は残す', () => {
    expect(updateCell('﻿id\tstatus\nA\ttodo\n', 'id', 'A', 'status', 'done')).toBe('﻿id\tstatus\nA\tdone\n')
  })

  test('見出しが無ければ、空の結果を返す', () => {
    expect(parseTsv('# だけ\n\n')).toEqual({ header: [], rows: [], lineNumbers: [] })
  })
})
