import { DANGLING_RULE_ID, isRuleTarget, type Item, type Leak, type Project, type Rule } from '../domain/model.js'

/** covered：from の種類の各行に、それを refs に持つ to の種類の行があるか */
function checkCovered(rule: Rule, items: readonly Item[]): Leak[] {
  const coveredIds = new Set(items.filter(i => i.kind === rule.to).flatMap(i => i.refs))
  return items
    .filter(i => isRuleTarget(rule, i) && !coveredIds.has(i.id))
    .map(i => ({ rule: rule.id, itemId: i.id, message: `${i.id}「${i.title}」に${rule.to}が紐づいていない（${rule.label}）` }))
}

/** refers：from の種類の各行が、to の種類の行を 1 つ以上 refs に持っているか */
function checkRefers(rule: Rule, items: readonly Item[]): Leak[] {
  const targetIds = new Set(items.filter(i => i.kind === rule.to).map(i => i.id))
  return items
    .filter(i => isRuleTarget(rule, i) && !i.refs.some(ref => targetIds.has(ref)))
    .map(i => ({ rule: rule.id, itemId: i.id, message: `${i.id}「${i.title}」が元にしている${rule.to}が書かれていない（${rule.label}）` }))
}

/** filled：from の種類の各行で、field 列が空でないか */
function checkFilled(rule: Rule, items: readonly Item[]): Leak[] {
  return items
    .filter(i => isRuleTarget(rule, i) && (i.fields[rule.field] ?? '').trim() === '')
    .map(i => ({ rule: rule.id, itemId: i.id, message: `${i.id}「${i.title}」の${rule.field}が空（${rule.label}）` }))
}

/** どのルールにも依らず、存在しない ID を指している行を出す */
function checkDangling(items: readonly Item[]): Leak[] {
  const ids = new Set(items.map(i => i.id))
  return items.flatMap(i => {
    const missing = i.refs.filter(ref => !ids.has(ref))
    return missing.length
      ? [{ rule: DANGLING_RULE_ID, itemId: i.id, message: `${i.id} が存在しない ID を指している：${missing.join('、')}` }]
      : []
  })
}

/**
 * ルールセットで台帳を見て、漏れの一覧を返す。
 * 人の承認のルールはここでは見ない（承認待ちは関門で扱う。tadori は代わりに承認しない）。
 */
export function runChecks(project: Project): Leak[] {
  const byRule = project.rules.flatMap(rule => {
    if (rule.kind === 'covered') return checkCovered(rule, project.items)
    if (rule.kind === 'refers') return checkRefers(rule, project.items)
    if (rule.kind === 'filled') return checkFilled(rule, project.items)
    return []
  })
  return [...byRule, ...checkDangling(project.items)]
}
