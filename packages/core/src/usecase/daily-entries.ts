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

/** バッジの色の意味（WBS のステータスの tone と同じ並び）。none＝ふつう / wait＝待ち / hole＝要注意 / ok＝よい */
export const BADGE_TONES = ['none', 'wait', 'hole', 'ok'] as const
export type BadgeTone = (typeof BADGE_TONES)[number]

/**
 * 行に付ける小さな札（例：遅延・確認待ち・期限 11/12）。中身は人かエージェントが決めて書く。
 * tadori は値を決めない（WBS を読んで遅れを判定する、などはしない）。WBS の無い案件でも使える
 */
export interface DailyBadge {
  readonly text: string
  readonly tone: BadgeTone
}

/**
 * upkeep＝台帳の整備（台帳の行を足した・直した。成果物の作業とは分けて出す）
 * summary＝課題ごとの要約（夕会で読み上げる一言〜三言。書くのはエージェントか人で、tadori は文を作らない）
 */
export type DailySection = 'today' | 'next' | 'consult' | 'upkeep' | 'summary'
export const DAILY_SECTIONS: readonly DailySection[] = ['today', 'next', 'consult', 'upkeep', 'summary']

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
  /** 行の札（文字と tone）。画面では本文とは別に色で出し、文では本文のうしろに出す */
  readonly badges?: readonly DailyBadge[]
  /**
   * 人かエージェントが最後にこの行を足した・直した時刻（その PC の時刻で YYYY-MM-DDTHH:MM）。
   * 自動の行と、この列ができる前に書いた行には無い
   */
  readonly updated?: string
}

/** 行のリンク。表示名は人が読む名前（例：QA表・設計書 3.2.5）。URL は http・https だけ */
export interface DailyLink {
  readonly label: string
  readonly url: string
  /** 本文の中の語。あれば画面ではその語をリンクにし、行末には出さない（本文に無ければ行末に出す） */
  readonly anchor?: string
  /** 同じ語が本文に何回も出るとき、何番目か（1 から。無ければ最初） */
  readonly nth?: number
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

/**
 * 前の作業日の「次の作業日」に、人が足した行・直した行を、今日の「今日」の予定として持ち越す。
 * 自動の行（WBS から作ったもの）は今日の WBS から作り直されるので持ち越さない（二重に出さない）。
 * 前の日の行は書き換えない。持ち越した行は自動の行と同じ扱いで、今日に直す・消すと、それが残る
 * （鍵は「carry:前の日:行の ID」）。
 */
export function carriedOver(previous: readonly DailyEntry[], previousDate: string): DailyEntry[] {
  return previous
    .filter(e => e.section === 'next' && (e.origin === 'manual' || e.origin === 'edited'))
    .map(e => {
      const { note, links, issue, ...rest } = e
      return {
        ...rest,
        id: '',
        section: 'today' as const,
        origin: 'auto' as const,
        tag: e.tag || 'plan',
        key: `carry:${previousDate}:${e.id}`,
        ...(issue ? { issue } : {}),
        ...(note ? { note } : {}),
        ...(links?.length ? { links } : {}),
      }
    })
}

/** 詳しく（今の表示）：要約の行を除いた、今までどおりの行 */
export function withoutSummaries(entries: readonly DailyEntry[]): DailyEntry[] {
  return entries.filter(e => e.section !== 'summary')
}

/**
 * 読み上げ：要約のある課題は、今日の細かい行の代わりに要約 1 行を今日の先頭に出す。
 * 要約の無い課題・課題の無い行・今日以外の見出しの行は、そのまま残す（要約を書き忘れても行は消えない）
 */
export function readAloud(entries: readonly DailyEntry[]): DailyEntry[] {
  const summaries = entries.filter(e => e.section === 'summary' && e.issue)
  if (!summaries.length) return [...entries]
  const summarized = new Set(summaries.map(e => e.issue))
  const rest = entries.filter(e => e.section !== 'summary' && !(e.section === 'today' && e.issue && summarized.has(e.issue)))
  return [...summaries.map(e => ({ ...e, section: 'today' as const })), ...rest]
}

/** 古い待ちの行の決まり。hours＝この時間より長く直していなければ古い（0 なら見ない）/ words＝本文にあれば待ちと読む語 */
export interface StaleRule {
  readonly hours: number
  readonly words: readonly string[]
}

const HOUR_MS = 60 * 60 * 1000

/**
 * 待ちの行か。待ちと読むのは、人かエージェントが付けた印だけ：tone が wait のバッジか、案件が決めた語（daily-format.tsv の wait_words）を本文に含むか。
 * tadori は本文の意味を推し量らない（語を決めていない案件では、バッジだけを見る）
 */
export const isWaiting = (entry: DailyEntry, words: readonly string[]): boolean =>
  (entry.badges ?? []).some(b => b.tone === 'wait') || words.some(w => w && entry.text.includes(w))

/**
 * 古いままの待ちの行（朝会・夕会の前に直す行）。待ちの行のうち、最後に直してから hours 以上たったもの。
 * 直した時刻の無い行（自動の行・前の版で書いた行）は、古さが分からないので入れない。消した行も入れない
 */
export function staleWaits(entries: readonly DailyEntry[], now: Date, rule: StaleRule): DailyEntry[] {
  if (!(rule.hours > 0)) return []
  return entries.filter(e => {
    if (e.origin === 'removed' || !e.updated || !isWaiting(e, rule.words)) return false
    const at = new Date(e.updated).getTime()
    return !Number.isNaN(at) && now.getTime() - at >= rule.hours * HOUR_MS
  })
}
