import { describe, expect, test } from 'vitest'
import { parseTestSheet } from '../src/infrastructure/test-sheet.js'

// md-business の検証シート（test-spec-tsv/v1）の形。中身は架空
const SHEET = [
  '#! md-business:test-spec-tsv/v1',
  '# タイトル: 貸出の検証シート',
  '#@ rowid _id',
  '#@ computed No. = rowNumber()',
  '#@ hidden r00000000000c',
  'No.:number\tケースID\t項目\t手順:multiline\t結果:enum(OK|NG|保留)\t仕様!\t_id',
  '1\tTC-01\t貸出の登録\t1. 開く\\n2. 押す\tOK\tSP-1、SP-2\tr00000000000a',
  '2\tTC-02\t返却\tC:\\\\tmp を開く\tNG\tSP-3\tr00000000000b',
  '3\tTC-03\t控えにした行\t\t\t\tr00000000000c',
  '',
].join('\n')

describe('検証シート（md-business の test-spec-tsv/v1）を読む', () => {
  test('型付きの見出しは名前だけを使い、セルのエスケープを戻し、行 ID と何行目かを持つ', () => {
    const sheet = parseTestSheet(SHEET)
    expect(sheet?.columns).toEqual(['No.', 'ケースID', '項目', '手順', '結果', '仕様'])
    expect(sheet?.rows[0]).toEqual({
      cells: { 'No.': '1', ケースID: 'TC-01', 項目: '貸出の登録', 手順: '1. 開く\n2. 押す', 結果: 'OK', 仕様: 'SP-1、SP-2' },
      rowId: 'r00000000000a',
      line: 7,
    })
    expect(sheet?.rows[1]?.cells.手順).toBe('C:\\tmp を開く')
  })

  test('控え（#@ hidden）の行は読まない', () => {
    expect(parseTestSheet(SHEET)?.rows.map(r => r.cells.ケースID)).toEqual(['TC-01', 'TC-02'])
  })

  test('宣言が無くても、末尾の列が _id なら行 ID の列。行 ID の列が無いシートも読める', () => {
    const noDirective = parseTestSheet('#! md-business:test-spec-tsv/v1\n項目\t_id\nA\tr0000000000aa\n')
    expect(noDirective?.rows[0]).toMatchObject({ cells: { 項目: 'A' }, rowId: 'r0000000000aa' })
    const noIds = parseTestSheet('#! md-business:test-spec-tsv/v1\n項目\t結果\nA\tOK\n')
    expect(noIds?.rows[0]).toEqual({ cells: { 項目: 'A', 結果: 'OK' }, line: 3 })
  })

  test('行 ID は r と 16 進 12 桁の形のものだけ使う（形の違う値は md-business が振り直すので使わない）', () => {
    const sheet = parseTestSheet('#! md-business:test-spec-tsv/v1\n項目\t_id\nA\tR-1\n')
    expect(sheet?.rows[0]).toEqual({ cells: { 項目: 'A' }, line: 3 })
  })

  test('先頭が test-spec-tsv/v1 の印でなければ、検証シートではない（null）', () => {
    expect(parseTestSheet('項目\t結果\nA\tOK\n')).toBeNull()
    expect(parseTestSheet('#! md-business:other/v1\n項目\nA\n')).toBeNull()
  })
})

describe('同じ行 ID が 2 行にあるとき', () => {
  test('最初の行のものだけを使う（md-business は 2 本目以降を振り直すので、食い違わない）', () => {
    const sheet = parseTestSheet('#! md-business:test-spec-tsv/v1\n項目\t_id\nA\tr00000000000a\nB\tr00000000000a\n')
    expect(sheet?.rows.map(r => r.rowId)).toEqual(['r00000000000a', undefined])
  })
})
