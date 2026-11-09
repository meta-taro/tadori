import type { Leak } from '../domain/model.js'
import type { CheckRecord } from '../infrastructure/settings-store.js'

/** 前のチェックでは漏れだったが、いまは漏れの無い行 */
export interface ResolvedItem {
  readonly itemId: string
  readonly rule: string
  /** 最後に漏れだったチェックの日時 */
  readonly when: string
}

/**
 * tadori check --log が書く行の形：what「R4 · …」、result「漏れ 2 件（DD-2.3・DD-3.2）」。
 * この形の行だけを読む（人の行や「満たす」の行は読まない）。
 */
// 英語の記録は result「Gaps: 2 (DD-2.3, DD-3.2)」。どちらの言語で書いた記録も読む
const LEAK_RESULT = /^(?:漏れ \d+ 件（(.+)）|Gaps: \d+ \((.+)\))$/
const RULE_ID = /^(\S+)\s*·/

/**
 * チェックの記録から「対応済み」の行を出す。新しい記録は作らず、すでにある記録を読むだけ。
 * 漏れが消えたことを tadori が「直った」と判定するのではない（認めるのは人）。見えるようにするだけ。
 */
export function resolvedItems(checks: readonly CheckRecord[], currentLeaks: readonly Leak[]): ResolvedItem[] {
  const stillLeaking = new Set(currentLeaks.map(l => l.itemId))
  const lastLeak = new Map<string, ResolvedItem>()
  for (const record of checks) {
    const found = record.result.match(LEAK_RESULT)
    const ids = found?.[1] ?? found?.[2]
    const rule = record.what.match(RULE_ID)?.[1]
    if (!ids || !rule) continue
    for (const itemId of ids.split(/[・,]/).map(s => s.trim()).filter(Boolean)) {
      const previous = lastLeak.get(itemId)
      if (!previous || previous.when <= record.when) lastLeak.set(itemId, { itemId, rule, when: record.when })
    }
  }
  return [...lastLeak.values()].filter(r => !stillLeaking.has(r.itemId)).sort((a, b) => a.itemId.localeCompare(b.itemId))
}
