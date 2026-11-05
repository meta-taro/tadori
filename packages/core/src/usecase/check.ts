import { DANGLING_RULE_ID, isRuleTarget, labelOf, LEDGER_FILES, type Item, type Labels, type Leak, type Project, type Rule } from '../domain/model.js'

/** 直し方の文で種類を書く：読み方があれば「試験の記録（RUN）」、無ければ記号を前後に空白を付けて */
const kindPhrase = (labels: Labels | undefined, code: string): string => {
  const name = labels?.kinds[code]
  return name ? `${name}（${code}）` : ` ${code} `
}

/** その行が書かれているファイル（WBS のタスクは wbs.tsv、ほかは台帳） */
const fileOf = (item: Item): string => item.file ?? (item.source === LEDGER_FILES.wbs ? LEDGER_FILES.wbs : LEDGER_FILES.items)

/** 直し方の文で行を指す：「ledger/items.tsv の DD-2.3 の行（12 行目）」 */
const rowOf = (item: Item): string => `${fileOf(item)} の ${item.id} の行${item.line ? `（${item.line} 行目）` : ''}`

/** 漏れに、直す行のファイルと行番号を付ける（分かるとき） */
const at = (item: Item): Pick<Leak, 'file' | 'line'> => ({ file: fileOf(item), ...(item.line ? { line: item.line } : {}) })

/** 漏れに、担当（ルールの owner）を付ける */
const withOwner = (rule: Rule, leak: Leak): Leak => (rule.owner ? { ...leak, owner: rule.owner } : leak)

/** covered：from の種類の各行に、それを refs に持つ to の種類の行があるか */
function checkCovered(rule: Rule, items: readonly Item[], labels?: Labels): Leak[] {
  const coveredIds = new Set(items.filter(i => i.kind === rule.to).flatMap(i => i.refs))
  return items
    .filter(i => isRuleTarget(rule, i) && !coveredIds.has(i.id))
    .map(i => withOwner(rule, {
      rule: rule.id,
      itemId: i.id,
      message: `${i.id}「${i.title}」に${labelOf(labels?.kinds, rule.to)}が紐づいていない（${rule.label}）`,
      fix: `${LEDGER_FILES.items} に${kindPhrase(labels, rule.to)}の行を足し、その refs に ${i.id} を書く`,
      ...at(i),
    }))
}

/** refers：from の種類の各行が、to の種類の行を 1 つ以上 refs に持っているか */
function checkRefers(rule: Rule, items: readonly Item[], labels?: Labels): Leak[] {
  const targetIds = new Set(items.filter(i => i.kind === rule.to).map(i => i.id))
  return items
    .filter(i => isRuleTarget(rule, i) && !i.refs.some(ref => targetIds.has(ref)))
    .map(i => withOwner(rule, {
      rule: rule.id,
      itemId: i.id,
      message: `${i.id}「${i.title}」が元にしている${labelOf(labels?.kinds, rule.to)}が書かれていない（${rule.label}）`,
      fix: `${rowOf(i)}の refs に、元にした${kindPhrase(labels, rule.to)}の ID を書く`,
      ...at(i),
    }))
}

/** filled：from の種類の各行で、field 列が空でないか */
function checkFilled(rule: Rule, items: readonly Item[], labels?: Labels): Leak[] {
  const column = labels?.columns[rule.field] ?? rule.field
  return items
    .filter(i => isRuleTarget(rule, i) && (i.fields[rule.field] ?? '').trim() === '')
    .map(i => withOwner(rule, {
      rule: rule.id,
      itemId: i.id,
      message: `${i.id}「${i.title}」の${labelOf(labels?.columns, rule.field)}が空（${rule.label}）`,
      fix: `${rowOf(i)}の「${column}」列に書く`,
      ...at(i),
    }))
}

/** どのルールにも依らず、存在しない ID を指している行を出す */
function checkDangling(items: readonly Item[]): Leak[] {
  const ids = new Set(items.map(i => i.id))
  return items.flatMap(i => {
    const missing = i.refs.filter(ref => !ids.has(ref))
    if (!missing.length) return []
    const list = missing.join('、')
    return [{
      rule: DANGLING_RULE_ID,
      itemId: i.id,
      message: `${i.id} が存在しない ID を指している：${list}`,
      fix: `${rowOf(i)}の refs から ${list} を消すか、${list} の行を台帳に足す`,
      ...at(i),
    }]
  })
}

/**
 * ルールセットで台帳を見て、漏れの一覧を返す。漏れには、担当と、どこをどう直せば消えるかを付ける。
 * 人の承認のルールはここでは見ない（承認待ちは完了判定で扱う。tadori は代わりに承認しない）。
 */
export function runChecks(project: Project): Leak[] {
  const byRule = project.rules.flatMap(rule => {
    if (rule.kind === 'covered') return checkCovered(rule, project.items, project.labels)
    if (rule.kind === 'refers') return checkRefers(rule, project.items, project.labels)
    if (rule.kind === 'filled') return checkFilled(rule, project.items, project.labels)
    return []
  })
  return [...byRule, ...checkDangling(project.items)]
}
