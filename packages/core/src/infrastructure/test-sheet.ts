/**
 * md-business の検証シート（カスタム TSV「test-spec-tsv/v1」）を読む。
 * tadori は読むだけで、書き戻さない（検証シートの正本は md-business）。
 *
 * 使うのは、形のうち次のものだけ（md-business の docs/spec/test-spec-tsv-v1.md）。
 * - 先頭の空でない行が `#! md-business:test-spec-tsv/v1`
 * - `#!`・`#@`・`#` で始まる行はデータではない。最初のデータ行が見出し（`名前:型(…)!` の名前だけ使う）
 * - セルは `\t` `\n` `\r` `\\` でエスケープされている（1 件 = 1 物理行）
 * - 行 ID は `#@ rowid 列名` の列、宣言が無ければ末尾の列が `_id` ならそれ
 * - `#@ hidden 行ID …` の行は、表から外した控え（読まない）
 */

const MAGIC = 'md-business:test-spec-tsv/v1'
/** 見出しのうしろに付く型の注記（例：結果:enum(OK|NG)・手順:multiline・仕様!） */
const TYPE_SUFFIX = /:(text|multiline|enum|radio|datetime|date|number|checkbox|url)(?:\([^)]*\))?$/
const DEFAULT_ROW_ID_COLUMN = '_id'
/** md-business の行 ID の形。形の違う値は md-business が次に読むときに振り直すので、ここでは無いものとして扱う */
const ROW_ID = /^r[0-9a-f]{12}$/

export interface TestSheetRow {
  /** 列名 → 値（エスケープを戻したもの。行 ID の列は含めない） */
  readonly cells: Readonly<Record<string, string>>
  /** md-business が振る行の ID（例 r3f9a2c81b40e）。行を挿しても変わらない */
  readonly rowId?: string
  /** ファイルの何行目か（1 から） */
  readonly line: number
}

export interface TestSheet {
  /** 列名（行 ID の列を除く） */
  readonly columns: readonly string[]
  readonly rows: readonly TestSheetRow[]
}

/** セルのエスケープを戻す。左から 1 文字ずつ読み、`\` の次の 1 文字だけを読み替える（`\\t` を誤ってタブにしない） */
export function unescapeCell(cell: string): string {
  let out = ''
  for (let i = 0; i < cell.length; i++) {
    const ch = cell[i]
    const next = cell[i + 1]
    if (ch !== '\\' || next === undefined) {
      out += ch
      continue
    }
    const decoded = next === 't' ? '\t' : next === 'n' ? '\n' : next === 'r' ? '\r' : next === '\\' ? '\\' : undefined
    // 知らない読み替え（\x など）は、バックスラッシュごとそのまま残す
    out += decoded ?? ch + next
    i++
  }
  return out
}

/** 見出しのセルから列名を取り出す（末尾の「!」と型の注記を外す） */
function columnName(cell: string): string {
  const withoutRequired = cell.endsWith('!') ? cell.slice(0, -1) : cell
  return unescapeCell(withoutRequired.replace(TYPE_SUFFIX, '')).trim()
}

interface Directives {
  readonly rowIdColumn?: string
  readonly hidden: ReadonlySet<string>
}

function readDirectives(lines: readonly string[]): Directives {
  let rowIdColumn: string | undefined
  const hidden = new Set<string>()
  for (const line of lines) {
    if (!line.startsWith('#@')) continue
    const [name, ...args] = line.slice(2).trim().split(/\s+/)
    // rowid は後勝ち、hidden は何行に分けても合わせる（md-business と同じ読み方）
    if (name === 'rowid' && args[0]) rowIdColumn = args[0]
    if (name === 'hidden') for (const id of args) hidden.add(id)
  }
  return { ...(rowIdColumn ? { rowIdColumn } : {}), hidden }
}

const isDataLine = (line: string) => line.trim() !== '' && !line.startsWith('#')

/** 検証シートを読む。先頭が test-spec-tsv/v1 の印でなければ null */
export function parseTestSheet(text: string): TestSheet | null {
  const lines = text.split('\n').map(l => l.replace(/\r$/, ''))
  const first = lines.find(l => l.trim() !== '')
  if (!first?.startsWith('#!') || first.slice(2).trim() !== MAGIC) return null

  const directives = readDirectives(lines)
  const headerAt = lines.findIndex(isDataLine)
  if (headerAt < 0) return { columns: [], rows: [] }
  const header = (lines[headerAt] as string).split('\t').map(columnName)
  const declared = directives.rowIdColumn ? header.indexOf(directives.rowIdColumn) : -1
  const rowIdAt = declared >= 0 ? declared : header.at(-1) === DEFAULT_ROW_ID_COLUMN ? header.length - 1 : -1

  const rows: TestSheetRow[] = []
  // 同じ行 ID が 2 行にあれば、md-business は 2 本目以降を振り直す。最初の行のものだけを使う
  const seen = new Set<string>()
  lines.forEach((line, i) => {
    if (i <= headerAt || !isDataLine(line)) return
    const raw = line.split('\t')
    const candidate = rowIdAt >= 0 ? (raw[rowIdAt] ?? '').trim() : ''
    const rowId = ROW_ID.test(candidate) && !seen.has(candidate) ? candidate : ''
    if (rowId) seen.add(rowId)
    if (rowId && directives.hidden.has(rowId)) return
    const cells = Object.fromEntries(header.flatMap((name, c) => (c === rowIdAt ? [] : [[name, unescapeCell(raw[c] ?? '')]])))
    rows.push({ cells, ...(rowId ? { rowId } : {}), line: i + 1 })
  })
  return { columns: header.filter((_, c) => c !== rowIdAt), rows }
}
