import { relative } from 'node:path'
import './i18n.js'
import { appendChecks, currentLang, t, type CheckRecord, type CommitResult } from '@tadori/core'
import { formatCheck } from './format.js'
import { loadState } from './state.js'

export interface CheckOptions {
  readonly today: string
  /** チェックの記録（.tadori/checks.tsv）に 5W1H で足すか */
  readonly log?: boolean
  readonly who?: string
  readonly why?: string
}

export interface CheckRun {
  readonly text: string
  readonly leakCount: number
  /** 記録を足したとき */
  readonly commit?: CommitResult
}

/** チェックの記録の結果の欄（日本語「漏れ 2 件（A・B）」／英語「Gaps: 2 (A, B)」、漏れが無ければ「満たす」／「Met」） */
export function leakResult(ids: readonly string[], isEnglish: boolean): string {
  if (!ids.length) return isEnglish ? 'Met' : '満たす'
  return isEnglish ? `Gaps: ${ids.length} (${ids.join(', ')})` : `漏れ ${ids.length} 件（${ids.join('・')}）`
}

/**
 * check の結果をチェックの記録の行にする（ルールごとに 1 行。人の承認のルールは人が記録するので入れない）。
 * 行の値は案件の TSV に残るデータ。書いたときの言語で書き、あとで画面の言語を替えても書き直さない
 */
function toRecords(state: Awaited<ReturnType<typeof loadState>>['state'], dir: string, options: CheckOptions): CheckRecord[] {
  const now = new Date()
  const when = `${options.today} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  const isEnglish = currentLang() === 'en'
  return state.rules.filter(r => r.kind !== 'approval').map(rule => {
    const leaks = state.leaks.filter(l => l.rule === rule.id)
    return {
      when,
      who: options.who ?? (isEnglish ? 'agent' : 'エージェント'),
      what: `${rule.id} · ${rule.label}`,
      where: relative(process.cwd(), dir) || '.',
      why: options.why ?? 'tadori check',
      how: 'tadori check',
      // 結果はあとで「対応済み」を見分けるのに読み戻すデータ。書く形は言語ごとに決めておき、core の history.ts がどちらも読む
      result: leakResult(leaks.map(l => l.itemId), isEnglish),
    }
  })
}

/** check を回す（CLI の tadori check と MCP の run_check が同じものを使う） */
export async function runCheck(dir: string, options: CheckOptions): Promise<CheckRun> {
  const { state } = await loadState(dir, options.today)
  const text = formatCheck(state)
  if (!options.log) return { text, leakCount: state.leaks.length }
  const commit = await appendChecks(dir, toRecords(state, dir, options), t('Add check records ({why})', { why: options.why ?? 'tadori check' }))
  return { text, leakCount: state.leaks.length, commit }
}
