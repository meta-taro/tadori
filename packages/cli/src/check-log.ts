import { relative } from 'node:path'
import './i18n.js'
import { appendChecks, t, type CheckRecord, type CommitResult } from '@tadori/core'
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

/**
 * check の結果をチェックの記録の行にする（ルールごとに 1 行。人の承認のルールは人が記録するので入れない）。
 * 行の値は案件の TSV に残るデータなので、画面の言語では訳さない
 */
function toRecords(state: Awaited<ReturnType<typeof loadState>>['state'], dir: string, options: CheckOptions): CheckRecord[] {
  const now = new Date()
  const when = `${options.today} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  return state.rules.filter(r => r.kind !== 'approval').map(rule => {
    const leaks = state.leaks.filter(l => l.rule === rule.id)
    return {
      when,
      who: options.who ?? 'エージェント',
      what: `${rule.id} · ${rule.label}`,
      where: relative(process.cwd(), dir) || '.',
      why: options.why ?? 'tadori check',
      how: 'tadori check',
      result: leaks.length ? `漏れ ${leaks.length} 件（${leaks.map(l => l.itemId).join('・')}）` : '満たす',
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
