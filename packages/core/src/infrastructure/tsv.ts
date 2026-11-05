/**
 * TSV を読む。1 行目（# と空行を除く）が見出し。
 * セルの値は加工しない（前後の空白も残す）。空のセルは空文字のまま。
 */
export interface Tsv {
  readonly header: readonly string[]
  readonly rows: readonly Record<string, string>[]
}

/** 表計算やメモ帳が先頭に付ける BOM。読むときは外し、書き戻すときは元のまま残す */
const BOM = '﻿'
const stripBom = (text: string): string => (text.startsWith(BOM) ? text.slice(1) : text)

const isSkipped = (line: string): boolean => line.trim() === '' || line.startsWith('#')

export function parseTsv(text: string): Tsv {
  const lines = stripBom(text).split(/\r?\n/).filter(line => !isSkipped(line))
  const [headerLine, ...bodyLines] = lines
  if (headerLine === undefined) return { header: [], rows: [] }

  const header = headerLine.split('\t')
  const rows = bodyLines.map(line => {
    const cells = line.split('\t')
    return Object.fromEntries(header.map((name, i) => [name, cells[i] ?? '']))
  })
  return { header, rows }
}

/**
 * 1 つのセルだけを書き換えた TSV を返す。ほかの行・# の行・列の並び・改行・BOM はそのまま残す
 * （人や md-business が書いた行を、tadori が並べ直したり消したりしないため）。
 * 対象の行が無ければ null。
 */
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
