/**
 * TSV を読む。1 行目（# と空行を除く）が見出し。
 * セルの値は加工しない（前後の空白も残す）。空のセルは空文字のまま。
 */
export interface Tsv {
  readonly header: readonly string[]
  readonly rows: readonly Record<string, string>[]
  /** rows と同じ並びで、その行がファイルの何行目か（1 から。# の行や空行も数える。md-business でその行を開くため） */
  readonly lineNumbers: readonly number[]
}

/** 表計算やメモ帳が先頭に付ける BOM。読むときは外し、書き戻すときは元のまま残す */
const BOM = '﻿'
const stripBom = (text: string): string => (text.startsWith(BOM) ? text.slice(1) : text)

const isSkipped = (line: string): boolean => line.trim() === '' || line.startsWith('#')

export function parseTsv(text: string): Tsv {
  const lines = stripBom(text).split(/\r?\n/)
    .map((line, index) => ({ line, number: index + 1 }))
    .filter(({ line }) => !isSkipped(line))
  const [headerLine, ...bodyLines] = lines
  if (headerLine === undefined) return { header: [], rows: [], lineNumbers: [] }

  const header = headerLine.line.split('\t')
  const rows = bodyLines.map(({ line }) => {
    const cells = line.split('\t')
    return Object.fromEntries(header.map((name, i) => [name, cells[i] ?? '']))
  })
  return { header, rows, lineNumbers: bodyLines.map(b => b.number) }
}

/**
 * 1 つのセルだけを書き換えた TSV を返す。ほかの行・# の行・列の並び・改行・BOM はそのまま残す
 * （人や md-business が書いた行を、tadori が並べ直したり消したりしないため）。
 * 対象の行が無ければ null。
 */
/** TSV の文を、BOM・改行の形・ヘッダの位置と一緒に分けて扱う（書き戻すときに、元の形を崩さないため） */
function splitTsv(text: string): { bom: string; newline: string; lines: string[]; headerIndex: number; header: string[] } {
  const bom = text.startsWith(BOM) ? BOM : ''
  const newline = text.includes('\r\n') ? '\r\n' : '\n'
  const lines = stripBom(text).split(/\r?\n/)
  const headerIndex = lines.findIndex(line => !isSkipped(line))
  const header = headerIndex < 0 ? [] : (lines[headerIndex] ?? '').split('\t')
  return { bom, newline, lines, headerIndex, header }
}

const cleanCell = (value: string) => value.replace(/[\t\r\n]+/g, ' ')

/**
 * key 列が key の行を直す（渡した列だけ）。無ければ最後に足す。ヘッダに無い列は右端に足す。
 * コメントの行・ほかの行・BOM・改行の形はそのまま残す（人や md-business が書いた行を崩さないため）。
 */
export function upsertRow(text: string, keyColumn: string, key: string, values: Readonly<Record<string, string>>): string {
  const { bom, newline, lines, headerIndex, header: original } = splitTsv(text)
  if (headerIndex < 0) throw new Error('TSV にヘッダの行がありません')
  const header = [...original, ...Object.keys({ [keyColumn]: key, ...values }).filter(c => !original.includes(c))]
  const keyAt = header.indexOf(keyColumn)
  const widen = (cells: string[]) => Array.from({ length: header.length }, (_, c) => cells[c] ?? '')
  let found = false
  const next = lines.map((line, i) => {
    if (i === headerIndex) return header.join('\t')
    if (i < headerIndex || isSkipped(line)) return line
    const cells = line.split('\t')
    if (cells[keyAt] !== key) return header.length > original.length ? widen(cells).join('\t') : line
    found = true
    const filled = widen(cells)
    for (const [column, value] of Object.entries(values)) filled[header.indexOf(column)] = cleanCell(value)
    return filled.join('\t')
  })
  if (!found) {
    const row = header.map(c => (c === keyColumn ? cleanCell(key) : cleanCell(values[c] ?? '')))
    // 最後の空行（ファイルの終わりの改行）の前に足す
    const at = next.at(-1) === '' ? next.length - 1 : next.length
    next.splice(at, 0, row.join('\t'))
  }
  return bom + next.join(newline)
}

/** key 列が key の行を消す。ほかの行とコメントは残す。無ければ null */
export function removeRow(text: string, keyColumn: string, key: string): string | null {
  const { bom, newline, lines, headerIndex, header } = splitTsv(text)
  const keyAt = header.indexOf(keyColumn)
  if (headerIndex < 0 || keyAt < 0) return null
  const next = lines.filter((line, i) => i <= headerIndex || isSkipped(line) || line.split('\t')[keyAt] !== key)
  return next.length === lines.length ? null : bom + next.join(newline)
}

export function updateCell(text: string, keyColumn: string, key: string, column: string, value: string): string | null {
  const bom = text.startsWith(BOM) ? BOM : ''
  const newline = text.includes('\r\n') ? '\r\n' : '\n'
  const lines = stripBom(text).split(/\r?\n/)
  const headerIndex = lines.findIndex(line => !isSkipped(line))
  if (headerIndex < 0) return null
  const header = (lines[headerIndex] ?? '').split('\t')
  const keyAt = header.indexOf(keyColumn)
  const valueAt = header.indexOf(column)
  if (keyAt < 0 || valueAt < 0) return null

  let found = false
  const next = lines.map((line, i) => {
    if (i <= headerIndex || isSkipped(line)) return line
    const cells = line.split('\t')
    if (cells[keyAt] !== key) return line
    found = true
    const filled = Array.from({ length: Math.max(cells.length, header.length) }, (_, c) => cells[c] ?? '')
    filled[valueAt] = value.replace(/[\t\r\n]+/g, ' ')
    return filled.join('\t')
  })
  return found ? bom + next.join(newline) : null
}

/** 行を TSV の文字列に戻す。セルの中のタブと改行は空白に置き換える（列がずれるのを防ぐ） */
export function toTsv(header: readonly string[], rows: readonly Record<string, string>[]): string {
  const clean = (value: string) => value.replace(/[\t\r\n]+/g, ' ')
  const lines = [header.join('\t'), ...rows.map(row => header.map(h => clean(row[h] ?? '')).join('\t'))]
  return `${lines.join('\n')}\n`
}
