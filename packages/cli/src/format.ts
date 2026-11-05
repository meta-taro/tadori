import type { TraceResult } from '@tadori/core'
import type { ProjectState } from './state.js'

/** tadori check の出力。工程ごとの漏れと承認待ちの中身だけを出す（割合や点数は出さない） */
export function formatCheck(state: ProjectState): string {
  const lines = [`${state.project.name}  （${state.today} 時点）`, '']
  for (const gate of state.gates) {
    const counts = [
      gate.leaks.length ? `漏れ ${gate.leaks.length}` : '',
      gate.pendingApprovals.length ? `承認待ち ${gate.pendingApprovals.length}（${gate.pendingApprovals.map(r => r.id).join('・')}）` : '',
    ].filter(Boolean).join(' / ') || '残りなし'
    const early = gate.startedBefore ? `  ← ${gate.startedBefore.name}の関門の前に着手` : ''
    const late = gate.maxLateDays ? `  ${gate.maxLateDays} 日遅れ` : ''
    lines.push(`■ ${gate.phase.name}  ${counts}${late}${early}`)
    for (const leak of gate.leaks) lines.push(`    ${leak.rule} ${leak.message}`)
  }
  const dangling = state.leaks.filter(l => !state.gates.some(g => g.leaks.includes(l)))
  if (dangling.length) {
    lines.push('■ どの工程にも属さない漏れ')
    for (const leak of dangling) lines.push(`    ${leak.rule} ${leak.message}`)
  }
  const waits = state.gates.reduce((n, g) => n + g.pendingApprovals.length, 0)
  lines.push('', `漏れ ${state.leaks.length} 件 / 承認待ち ${waits} 件`)
  return lines.join('\n')
}

/** tadori why の出力。元から順に並べ、切れ目には ✗ を付ける */
export function formatTrace(result: TraceResult): string {
  return result.steps.map(step => {
    if (step.type === 'missing') return `    ✗ ${step.kind} が無い（${step.rule}）  ← ここで切れている`
    const mark = step.item.id === result.start.id ? '▶' : '・'
    return `${mark} ${step.item.kind.padEnd(6)} ${step.item.id}  ${step.item.title}  （${step.item.source}）`
  }).join('\n')
}
