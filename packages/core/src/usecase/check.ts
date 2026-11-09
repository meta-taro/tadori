import { DANGLING_RULE_ID, isRuleTarget, LEDGER_FILES, type Item, type Labels, type Leak, type Project, type Rule } from '../domain/model.js'
import { joinList, t } from '../i18n.js'

/** 種類・列の読み方（あれば）。読み方の有る無しで文の形が変わるので、文ごとに鍵を分ける */
const nameOf = (names: Readonly<Record<string, string>> | undefined, code: string): string | undefined => names?.[code] || undefined

/** その行が書かれているファイル（WBS のタスクは wbs.tsv、ほかは台帳） */
const fileOf = (item: Item): string => item.file ?? (item.source === LEDGER_FILES.wbs ? LEDGER_FILES.wbs : LEDGER_FILES.items)

/** 直し方の文で行を指す：「ledger/items.tsv の DD-2.3 の行（12 行目）」 */
const rowOf = (item: Item): string => item.line
  ? t('the {id} row in {file} (line {line})', { id: item.id, file: fileOf(item), line: item.line })
  : t('the {id} row in {file}', { id: item.id, file: fileOf(item) })

/** 漏れに、直す行のファイルと行番号を付ける（分かるとき） */
const at = (item: Item): Pick<Leak, 'file' | 'line'> => ({ file: fileOf(item), ...(item.line ? { line: item.line } : {}) })

/** 漏れに、担当（ルールの owner）を付ける */
const withOwner = (rule: Rule, leak: Leak): Leak => (rule.owner ? { ...leak, owner: rule.owner } : leak)

/** covered：from の種類の各行に、それを refs に持つ to の種類の行があるか */
function checkCovered(rule: Rule, items: readonly Item[], labels?: Labels): Leak[] {
  const coveredIds = new Set(items.filter(i => i.kind === rule.to).flatMap(i => i.refs))
  const kindName = nameOf(labels?.kinds, rule.to)
  return items
    .filter(i => isRuleTarget(rule, i) && !coveredIds.has(i.id))
    .map(i => {
      const vars = { id: i.id, title: i.title, kind: rule.to, kindName: kindName ?? '', rule: rule.label, file: LEDGER_FILES.items }
      return withOwner(rule, {
        rule: rule.id,
        itemId: i.id,
        message: kindName
          ? t('{id} "{title}" has no linked {kindName} ({rule})', vars)
          : t('{id} "{title}" has no linked {kind} ({rule})', vars),
        fix: kindName
          ? t('Add a {kindName} ({kind}) row to {file} and write {id} in its refs', vars)
          : t('Add a {kind} row to {file} and write {id} in its refs', vars),
        ...at(i),
      })
    })
}

/** refers：from の種類の各行が、to の種類の行を 1 つ以上 refs に持っているか */
function checkRefers(rule: Rule, items: readonly Item[], labels?: Labels): Leak[] {
  const targetIds = new Set(items.filter(i => i.kind === rule.to).map(i => i.id))
  const kindName = nameOf(labels?.kinds, rule.to)
  return items
    .filter(i => isRuleTarget(rule, i) && !i.refs.some(ref => targetIds.has(ref)))
    .map(i => {
      const vars = { id: i.id, title: i.title, kind: rule.to, kindName: kindName ?? '', rule: rule.label, row: rowOf(i) }
      return withOwner(rule, {
        rule: rule.id,
        itemId: i.id,
        message: kindName
          ? t('{id} "{title}" does not name the {kindName} it is based on ({rule})', vars)
          : t('{id} "{title}" does not name the {kind} it is based on ({rule})', vars),
        fix: kindName
          ? t('In the refs of {row}, write the ID of the {kindName} ({kind}) it is based on', vars)
          : t('In the refs of {row}, write the ID of the {kind} it is based on', vars),
        ...at(i),
      })
    })
}

/** filled：from の種類の各行で、field 列が空でないか */
function checkFilled(rule: Rule, items: readonly Item[], labels?: Labels): Leak[] {
  const columnName = nameOf(labels?.columns, rule.field)
  const column = columnName ?? rule.field
  return items
    .filter(i => isRuleTarget(rule, i) && (i.fields[rule.field] ?? '').trim() === '')
    .map(i => {
      const vars = { id: i.id, title: i.title, field: rule.field, columnName: columnName ?? '', column, rule: rule.label, row: rowOf(i) }
      return withOwner(rule, {
        rule: rule.id,
        itemId: i.id,
        message: columnName
          ? t('{id} "{title}" has an empty {columnName} ({rule})', vars)
          : t('{id} "{title}" has an empty {field} ({rule})', vars),
        fix: t('Fill in the "{column}" column of {row}', vars),
        ...at(i),
      })
    })
}

/** どのルールにも依らず、存在しない ID を指している行を出す */
function checkDangling(items: readonly Item[]): Leak[] {
  const ids = new Set(items.map(i => i.id))
  return items.flatMap(i => {
    const missing = i.refs.filter(ref => !ids.has(ref))
    if (!missing.length) return []
    const list = joinList(missing, '、')
    return [{
      rule: DANGLING_RULE_ID,
      itemId: i.id,
      message: t('{id} points to IDs that do not exist: {list}', { id: i.id, list }),
      fix: t('Remove {list} from the refs of {row}, or add rows for {list} to the ledger', { list, row: rowOf(i) }),
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
