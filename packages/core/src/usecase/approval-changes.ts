import type { Project, Rule } from '../domain/model.js'

/** あるファイルを最後に変えた commit（短い ID と、commit の日時 ISO 8601） */
export interface FileChange {
  readonly commit: string
  readonly date: string
}

/** 承認のあとに変わったファイルと、その commit */
export interface ChangeAfterApproval extends FileChange {
  readonly file: string
}

/**
 * 台帳の行の source から、ファイルの場所だけを取り出す（「docs/a.md §2」「src/a.ts:42」→ そのファイル）。
 * リンク（http など）や空は、git で見られないので空を返す。
 */
export function sourceFile(source: string): string {
  const head = source.trim().split(/\s+/)[0] ?? ''
  if (!head || /^[a-z][a-z0-9+.-]*:\/\//i.test(head)) return ''
  return head.replace(/:\d+(?::\d+)?$/, '')
}

/**
 * 承認のルールが見る文書：ルールの from の種類の行の source（重ねない・並べる）。
 * from が無い承認のルールは何も見ない（承認の記録だけで決まる、これまでの形）。
 */
export function approvalTargets(project: Project, rule: Rule): string[] {
  if (rule.kind !== 'approval' || !rule.from) return []
  const files = project.items.filter(item => item.kind === rule.from).map(item => sourceFile(item.source)).filter(Boolean)
  return [...new Set(files)].sort()
}

/** 日付だけ（YYYY-MM-DD）の承認か */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

/**
 * 承認のあとに見る文書が commit されたか。されていれば、その中でいちばん新しい変更を返す。
 * - 承認が日付だけなら、承認の日より後の日の commit だけを数える（同じ日はどちらが先か分からないので、戻さない）
 * - 承認に時刻まであれば、時刻で比べる
 * - 承認の日付が読めなければ戻さない（読めない日付で、人の承認を消さない）
 */
export function changedAfterApproval(when: string, files: readonly string[], changes: Readonly<Record<string, FileChange>>): ChangeAfterApproval | undefined {
  const approvedAt = when.trim()
  const isDateOnly = DATE_ONLY.test(approvedAt)
  const approvedTime = Date.parse(approvedAt)
  if (!isDateOnly && Number.isNaN(approvedTime)) return undefined
  const isAfter = (change: FileChange): boolean => (isDateOnly ? change.date.slice(0, 10) > approvedAt : Date.parse(change.date) > approvedTime)
  const after = files.flatMap(file => {
    const change = changes[file]
    return change && isAfter(change) ? [{ file, ...change }] : []
  })
  return after.sort((a, b) => Date.parse(b.date) - Date.parse(a.date)).at(0)
}
