import type { Item, Project } from '../domain/model.js'
import { approvalTargets, sourceFile } from './approval-changes.js'

/** 承認の状態の名前（approvals.tsv の status） */
const APPROVED = '承認'

/** 台帳の行が指す文書と、それを指す行・その文書を見る承認 */
export interface LedgerDocument {
  /** 文書の場所（案件のフォルダからの相対） */
  readonly file: string
  /** この文書を source に持つ行（台帳の順） */
  readonly items: readonly Item[]
  /** この文書を見る承認のルールと、承認した最後の日時（承認が無ければ無い） */
  readonly approval?: { readonly rule: string; readonly when: string }
}

/**
 * 行の ID か文書の場所から、台帳の行が指す文書を引く。
 * 台帳のどの行も source に持たないファイルは引かない（版と差分を、台帳に名前のある文書だけに限るため）
 */
export function ledgerDocument(project: Project, idOrFile: string): LedgerDocument | null {
  const key = idOrFile.trim()
  const byId = project.items.find(i => i.id === key)
  const file = byId ? sourceFile(byId.source) : key
  if (!file) return null
  const items = project.items.filter(i => sourceFile(i.source) === file)
  if (!items.length) return null
  return { file, items, ...approvalOf(project, file) }
}

/** その文書を見る承認のルールのうち、承認した最後の記録 */
function approvalOf(project: Project, file: string): Pick<LedgerDocument, 'approval'> {
  const rules = new Set(project.rules.filter(r => approvalTargets(project, r).includes(file)).map(r => r.id))
  const latest = project.approvals
    .filter(a => rules.has(a.rule) && a.status === APPROVED && a.when)
    .sort((a, b) => a.when.localeCompare(b.when))
    .at(-1)
  return latest ? { approval: { rule: latest.rule, when: latest.when } } : {}
}
