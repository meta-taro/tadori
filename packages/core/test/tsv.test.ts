import { describe, expect, test } from 'vitest'
import { parseTsv, removeRow, updateCell, upsertRow } from '../src/infrastructure/tsv.js'

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

describe('upsertRow（行を足す・直す。コメントと BOM と改行の形は残す）', () => {
  const base = '﻿# 台帳\r\nid\tkind\ttitle\r\nA-1\tA\t一\r\n# 途中のコメント\r\nA-2\tA\t二\r\n'

  test('あれば渡した列だけを直し、ほかの行とコメントは触らない', () => {
    const out = upsertRow(base, 'id', 'A-2', { title: '二の改' })
    expect(out).toBe('﻿# 台帳\r\nid\tkind\ttitle\r\nA-1\tA\t一\r\n# 途中のコメント\r\nA-2\tA\t二の改\r\n')
  })

  test('無ければ最後に足す。足りない列は空にする', () => {
    expect(upsertRow(base, 'id', 'A-3', { kind: 'A', title: '三' })).toBe(`${base}A-3\tA\t三\r\n`)
  })

  test('ヘッダに無い列は、右端に足す（ほかの行は空）', () => {
    const out = upsertRow('id\ttitle\nA-1\t一\n', 'id', 'A-1', { owner: '設計担当' })
    expect(out).toBe('id\ttitle\towner\nA-1\t一\t設計担当\n')
  })

  test('値のタブや改行は空白にする', () => {
    expect(upsertRow('id\ttitle\n', 'id', 'A-1', { title: 'a\tb\nc' })).toBe('id\ttitle\nA-1\ta b c\n')
  })
})

describe('removeRow', () => {
  test('その行だけを消す。無ければ null', () => {
    expect(removeRow('id\tt\nA\t1\n# c\nB\t2\n', 'id', 'A')).toBe('id\tt\n# c\nB\t2\n')
    expect(removeRow('id\tt\nA\t1\n', 'id', 'Z')).toBeNull()
  })
})
