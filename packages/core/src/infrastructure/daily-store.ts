import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { DAILY_SECTIONS, type DailyEntry, type DailyLink, type DailyOrigin, type DailySection, type Member } from '../usecase/daily-entries.js'
import { commitFiles, type CommitResult } from './git.js'
import { ownersOf } from '../domain/people.js'
import { parseTsv, toTsv } from './tsv.js'

/** 日ごとの「1 日の進行」（tadori が書く記録。チェックの記録と同じく .tadori/ に置き、git で残す） */
export const DAILY_DIR = '.tadori/daily'
const MEMBERS = '.tadori/members.tsv'
/** 1 日の進行の文の形（見出しの言葉など）。案件ごとに決める。書かなければ tadori の既定の形 */
const DAILY_FORMAT = '.tadori/daily-format.tsv'
// tag・links は後から足した列なので最後に置く（前の版で書いたファイルも、そのまま読める）
const COLUMNS = ['id', 'who', 'section', 'text', 'wbs', 'issue', 'note', 'origin', 'key', 'tag', 'links'] as const

/** 行のリンクは「表示名 URL | 表示名 URL」の 1 セルに書く（人が TSV を開いても読める。URL に空白は入らないので、最後の空白で分けられる） */
const LINK_SEPARATOR = ' | '
// 本文の語をリンクにするときは「表示名 URL > 語 #番目」（#番目は 2 回目以降のときだけ）
const ANCHOR_MARK = ' > '
const linkToText = (l: DailyLink) => `${l.label} ${l.url}${l.anchor ? `${ANCHOR_MARK}${l.anchor}${l.nth && l.nth > 1 ? ` #${l.nth}` : ''}` : ''}`
const linksToCell = (links: readonly DailyLink[] | undefined) => (links ?? []).map(linkToText).join(LINK_SEPARATOR)
function linksFromCell(cell: string): DailyLink[] {
  return cell.split(LINK_SEPARATOR).map(part => part.trim()).filter(Boolean).flatMap(part => {
    // URL は空白を含まない。最初の http(s):// の語が URL で、その前が表示名、後ろが語
    const match = /^(.*?)\s+(https?:\/\/\S+)(?:\s+>\s+(.+?))?$/.exec(part)
    if (!match) return []
    const [, label = '', url = '', anchorPart] = match
    const nthMatch = anchorPart ? /^(.*?)\s+#(\d+)$/.exec(anchorPart) : null
    const anchor = nthMatch ? nthMatch[1] : anchorPart
    const nth = nthMatch ? Number(nthMatch[2]) : undefined
    return [{ label: label.trim(), url, ...(anchor ? { anchor: anchor.trim() } : {}), ...(nth && nth > 1 ? { nth } : {}) }]
  })
}
const ORIGINS: readonly DailyOrigin[] = ['auto', 'edited', 'manual', 'removed']

export const dailyPath = (date: string) => `${DAILY_DIR}/${date}.tsv`

async function readIfExists(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch (error: unknown) {
    // 無いのは「まだ作っていない」だけ。ほかの失敗（権限など）は隠さない
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

const splitIds = (value: string) => value.split(/[、,]/).map(s => s.trim()).filter(Boolean)

function toEntry(row: Record<string, string>, path: string): DailyEntry {
  const section = row.section as DailySection
  const origin = row.origin as DailyOrigin
  if (!DAILY_SECTIONS.includes(section)) throw new Error(`${path} の ${row.id}：section「${row.section}」は ${DAILY_SECTIONS.join(' / ')} のどれかにしてください`)
  if (!ORIGINS.includes(origin)) throw new Error(`${path} の ${row.id}：origin「${row.origin}」は ${ORIGINS.join(' / ')} のどれかにしてください`)
  return {
    id: row.id ?? '',
    who: row.who ?? '',
    section,
    text: row.text ?? '',
    wbs: splitIds(row.wbs ?? ''),
    ...(row.issue ? { issue: row.issue } : {}),
    ...(row.note ? { note: row.note } : {}),
    origin,
    ...(row.key ? { key: row.key } : {}),
    ...(row.tag ? { tag: row.tag } : {}),
    ...(row.links ? { links: linksFromCell(row.links) } : {}),
  }
}

/** その日の行を読む。まだ作っていない日は空 */
export async function readDaily(dir: string, date: string): Promise<DailyEntry[]> {
  const text = await readIfExists(join(dir, dailyPath(date)))
  if (text === null) return []
  return parseTsv(text).rows.filter(r => r.id).map(r => toEntry(r, dailyPath(date)))
}

/** その日の行を書き、案件が git リポジトリなら commit する（push はしない） */
export async function writeDaily(dir: string, date: string, entries: readonly DailyEntry[], message: string): Promise<CommitResult> {
  const path = dailyPath(date)
  await mkdir(dirname(join(dir, path)), { recursive: true })
  const rows = entries.map(e => ({ ...e, wbs: e.wbs.join(','), issue: e.issue ?? '', note: e.note ?? '', key: e.key ?? '', tag: e.tag ?? '', links: linksToCell(e.links) }))
  await writeFile(join(dir, path), toTsv(COLUMNS, rows as unknown as Record<string, string>[]), 'utf8')
  return commitFiles(dir, [path], message)
}

/** 人の表（列 name・git・roles。書かなくてもよい） */
export async function readMembers(dir: string): Promise<Member[]> {
  const text = await readIfExists(join(dir, MEMBERS))
  if (text === null) return []
  // roles は「設計担当・レビュー担当」のように複数書ける。git は書かなくてもよい（役割の対応だけを書く案件もある）
  return parseTsv(text).rows.filter(r => r.name).map(r => ({ name: r.name as string, git: r.git ?? '', roles: ownersOf(r.roles) }))
}

/** 1 日の進行の文の形の設定（列 key・value）。書かなくてもよい。知らない key は使わない */
export async function readDailyFormat(dir: string): Promise<Record<string, string>> {
  const text = await readIfExists(join(dir, DAILY_FORMAT))
  if (text === null) return {}
  return Object.fromEntries(parseTsv(text).rows.filter(r => r.key).map(r => [r.key as string, r.value ?? '']))
}
