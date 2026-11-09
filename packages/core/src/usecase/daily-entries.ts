import { ownersOf, type DailyLine, type DailySheet } from './daily.js'
import type { Member } from '../domain/people.js'

export type { Member }

/**
 * 「1 日の進行」の 1 件。材料から作った下書きを日ごとのファイルに置き、人とエージェントが直す。
 * tadori は文の中身を判定しない。直すのは人かエージェントで、直した行は作り直しても上書きしない。
 */

/** today＝今日 / next＝次の作業日 / consult＝相談 */
/** 行の印の種類（言葉は案件ごとに決める） */
export const DAILY_TAGS = ['done', 'doing', 'plan', 'upkeep', 'checked'] as const

/** upkeep＝台帳の整備（台帳の行を足した・直した。成果物の作業とは分けて出す） */
export type DailySection = 'today' | 'next' | 'consult' | 'upkeep'
export const DAILY_SECTIONS: readonly DailySection[] = ['today', 'next', 'consult', 'upkeep']

/**
 * auto＝tadori が作った下書きのまま / edited＝人かエージェントが直した / manual＝人かエージェントが足した /
 * removed＝消した（作り直しで同じ行が戻ってこないよう、印だけ残す）
 */
export type DailyOrigin = 'auto' | 'edited' | 'manual' | 'removed'

export interface DailyEntry {
  /** その日の中で一意（自動の行は a1・a2…、足した行は m1・m2…） */
  readonly id: string
  /** 担当（「A・B」のように複数も可） */
  readonly who: string
  readonly section: DailySection
  /** 本文（番号と末尾の WBS は付けない。画面と文に出すときに足す） */
  readonly text: string
  /** つながる WBS の ID（末尾の「WBS 番号 状態 期限」と補足に使う） */
  readonly wbs: readonly string[]
  /** 課題の ID（補足に正式な名前と場所を出す） */
  readonly issue?: string
  /** 補足に足す一言（聞かれたら読むもの） */
  readonly note?: string
  readonly origin: DailyOrigin
  /**
   * 行の印（やり終えたことか、これからのことかを一目で分けるため）。言葉は案件の daily-format.tsv で決める。
   * done＝やり終えた / doing＝作業中 / plan＝予定 / upkeep＝台帳の整備 / checked＝確かめた
   */
  readonly tag?: string
  /** 自動の行がどの材料から来たか（作り直したとき同じものを見分ける。例：wbs:today:W-01） */
  readonly key?: string
  /** その作業でさわった正本の場所（表示名と URL）。画面では行の末尾に「表示名 ↗」で出し、読み上げる文には入れない */
  readonly links?: readonly DailyLink[]
}

/** 行のリンク。表示名は人が読む名前（例：QA表・設計書 3.2.5）。URL は http・https だけ */
export interface DailyLink {
  readonly label: string
  readonly url: string
}

/** 人かエージェントが触った行か */
const touched = (e: DailyEntry) => e.origin !== 'auto'

function nextId(used: ReadonlySet<string>, prefix: string): string {
  let n = 1
  while (used.has(`${prefix}${n}`)) n += 1
  return `${prefix}${n}`
}

/**
 * 置いてある行と、新しく作った自動の行を合わせる（元の配列は変えない）。
 * - 人かエージェントが触った行（直した・足した・消した）は、そのまま残す
 * - 触っていない自動の行は、同じ key の新しい中身にする。材料が無くなったものは外す
 * - 新しく見つかった自動の行は、後ろに足す
 */
export function mergeDaily(existing: readonly DailyEntry[], fresh: readonly DailyEntry[]): DailyEntry[] {
  const freshByKey = new Map(fresh.filter(e => e.key).map(e => [e.key as string, e]))
  const keysTaken = new Set(existing.flatMap(e => (e.key ? [e.key] : [])))
  const used = new Set(existing.map(e => e.id))

  const kept = existing.flatMap(e => {
    if (touched(e)) return [e]
    const renewed = e.key ? freshByKey.get(e.key) : undefined
    return renewed ? [{ ...renewed, id: e.id }] : []
  })
  const added = fresh.filter(e => !e.key || !keysTaken.has(e.key)).map(e => {
    const id = nextId(used, 'a')
    used.add(id)
    return { ...e, id }
  })
  return [...kept, ...added]
}

/** git の作者名を担当にする。表に無ければ作者名のまま（WBS の担当と git の名前をそろえていれば、表は要らない） */
export function memberOf(author: string, members: readonly Member[]): string {
  return members.find(m => m.git && m.git === author)?.name ?? author
}

/**
 * WBS の変化から作った下書き（今日・次の作業日）を、日ごとのファイルの行にする。
 * continued は、次の作業日も続く作業の頭に付ける印（案件の設定。既定は付けない）。
 */
export function entriesFromSheet(sheet: DailySheet, continued = ''): DailyEntry[] {
  // 印のあとに区切りが無ければ空白を入れる（印が後ろの作業すべてにかかって見えないように）
  const mark = continued && !/[\s:：・、)）\]］]$/.test(continued) ? `${continued} ` : continued
  const toEntry = (section: DailySection) => (line: DailyLine): DailyEntry => {
    const issue = line.issue ? `${line.issue.id} ${line.issue.short ?? line.issue.title} ` : ''
    const who = [...new Set(line.tasks.flatMap(t => ownersOf(t.owner)))].join('・')
    const ids = line.tasks.map(t => t.id)
    return {
      id: '',
      who,
      section,
      text: `${issue}${line.continued ? mark : ''}${line.tasks.map(t => t.name).join('・')}`,
      wbs: ids,
      ...(line.issue ? { issue: line.issue.id } : {}),
      origin: 'auto',
      key: `wbs:${section}:${ids.join('+')}`,
      // 今日に済みへ変わった作業は done、途中の状態へ変わった作業は doing、次の作業日の行は plan
      tag: section === 'next' ? 'plan' : line.finished ? 'done' : 'doing',
    }
  }
  return [...sheet.today.map(toEntry('today')), ...sheet.next.map(toEntry('next'))]
}
