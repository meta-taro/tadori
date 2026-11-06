import type { TraceResult } from '@tadori/core'
import type { ProjectState } from './state.js'

/** tadori check の出力。工程ごとの漏れと承認待ちの中身だけを出す（割合や点数は出さない） */
export function formatCheck(state: ProjectState): string {
  const lines = [`${state.project.name}  （${state.today} 時点）`, '']
  for (const gate of state.gates) {
    const counts = [
      gate.leaks.length ? `漏れ ${gate.leaks.length}` : '',
      gate.pendingApprovals.length ? `承認待ち ${gate.pendingApprovals.length}（${gate.pendingApprovals.map(r => r.id).join('・')}）` : '',
    ].filter(Boolean).join(' / ') || (gate.rules.length ? '残りなし' : 'ルールなし（まだ判定していません）')
    const early = gate.startedBefore ? `  ← ${gate.startedBefore.name}の完了判定より前に着手` : ''
    const late = gate.maxLateDays ? `  ${gate.maxLateDays} 日遅れ` : ''
    lines.push(`■ ${gate.phase.name}  ${counts}${late}${early}`)
    for (const leak of gate.leaks) {
      lines.push(`    ${leak.rule} ${leak.message}`)
      // 誰が・どこをどう直せば消えるか
      if (leak.fix) lines.push(`        ${leak.owner ? `担当：${leak.owner}　` : ''}直し方：${leak.fix}`)
    }
    for (const p of gate.pending) lines.push(`    ${p.rule.id} 承認待ち（${p.status}）　直し方：${p.fix}`)
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
  // 切れ目として出す漏れは、行の下に重ねて出さない
  const shownAsGap = new Set(result.steps.flatMap(s => (s.type === 'missing' ? [`${s.rule}:${s.after ?? s.before}`] : [])))
  return result.steps.flatMap(step => {
    if (step.type === 'missing') {
      const where = step.before ? '上流の' : ''
      return [`    ✗ ${where}${step.kind} が無い（${step.rule}）  ← ここで切れている`]
    }
    const other = step.leaks.filter(l => !shownAsGap.has(`${l.rule}:${l.itemId}`))
    const mark = step.item.id === result.start.id ? '▶' : other.length ? '✗' : '・'
    return [
      `${mark} ${step.item.kind.padEnd(6)} ${step.item.id}  ${step.item.title}  （${step.item.source}）`,
      // つながり以外の漏れ（列が空など）は、その行の下に出す
      ...other.map(l => `      漏れ ${l.rule}：${l.message}`),
    ]
  }).join('\n')
}
