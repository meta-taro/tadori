import './i18n.js'
import { docDiff, docVersions, ledgerDocument, loadProject, t, versionAt, type DocVersion, type LedgerDocument } from '@tadori/core'

interface ToolResult {
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
}

interface Tool {
  readonly name: string
  readonly description: string
  readonly inputSchema: Record<string, unknown>
  run(args: Record<string, unknown>): Promise<ToolResult>
}

const reply = (body: string, isError = false): ToolResult => ({ content: [{ type: 'text', text: body }], ...(isError ? { isError } : {}) })
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

/** 差分のもと：from を書いていれば、その版。無ければ承認した日の版（承認が無ければ差分は出さない） */
export function diffBase(doc: LedgerDocument, versions: readonly DocVersion[], from: string): { commit: string; why: string } | null {
  if (from) return { commit: from, why: t('from {commit}', { commit: from }) }
  if (!doc.approval) return null
  const approved = versionAt(versions, doc.approval.when)
  return approved ? { commit: approved.commit, why: t('from the version approved on {when} ({rule}, {commit})', { when: doc.approval.when, rule: doc.approval.rule, commit: approved.commit }) } : null
}

/** 画面に渡す、資料の版と差分 */
export interface DocView {
  readonly file: string
  readonly items: readonly string[]
  readonly approval: { readonly rule: string; readonly when: string; readonly commit: string } | null
  readonly versions: readonly DocVersion[]
  /** 差分のもとにした版（無ければ差分は出さない） */
  readonly from: string
  readonly to: string
  readonly diff: string
}

/** 画面の口（GET /api/doc?id=&from=&to=）。台帳に名前の無い文書・commit の ID でない版は DocRefused */
export async function docView(dir: string, params: URLSearchParams): Promise<DocView> {
  const doc = ledgerDocument(await loadProject(dir), params.get('id') ?? '')
  if (!doc) throw new DocRefused(t('{id} is not a document named in the ledger (only files in the source column of ledger rows can be read)', { id: params.get('id') ?? '' }))
  const versions = await docVersions(dir, doc.file)
  const approvedCommit = doc.approval ? versionAt(versions, doc.approval.when)?.commit ?? '' : ''
  const base = diffBase(doc, versions, (params.get('from') ?? '').trim())
  const to = (params.get('to') ?? '').trim()
  let diff = ''
  try {
    diff = base ? await docDiff(dir, doc.file, base.commit, to || undefined) : ''
  } catch (error: unknown) {
    throw new DocRefused(error instanceof Error ? error.message : String(error))
  }
  return {
    file: doc.file, items: doc.items.map(i => i.id), versions, from: base?.commit ?? '', to, diff,
    approval: doc.approval ? { ...doc.approval, commit: approvedCommit } : null,
  }
}

/** 読めない頼み（画面には 400 で返す） */
export class DocRefused extends Error {}

/** 版の並びの文（新しい順・承認した版に印） */
export function versionsText(doc: LedgerDocument, versions: readonly DocVersion[]): string {
  const approved = doc.approval ? versionAt(versions, doc.approval.when)?.commit : undefined
  const head = t('{file} (rows: {items})', { file: doc.file, items: doc.items.map(i => i.id).join(', ') })
  if (!versions.length) return `${head}\n${t('No versions: the document is not committed, or the project is not in git')}`
  const lines = versions.map(v => `- ${v.commit} ${v.date.slice(0, 16).replace('T', ' ')} ${v.subject}${v.commit === approved ? t(' ← approved version') : ''}`)
  return [head, ...lines].join('\n')
}

/** 資料の版と差分の道具。案件は options.projectDir（open_project で替わる）を読む */
export function docTools(options: { projectDir?: string }): Tool[] {
  return [{
    name: 'doc_versions',
    description: t('For a document a ledger row points to (its source), list its versions from git (newest first) and the diff of that document. '
      + 'By default the diff runs from the version approved last to the latest commit, so you can tell what changed after approval. Only documents named in the ledger can be read.'),
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: t('Ledger row ID (e.g. BD-2) or the document path written in source') },
        from: { type: 'string', description: t('Commit ID to diff from (default: the version approved last)') },
        to: { type: 'string', description: t('Commit ID to diff to (default: the latest commit)') },
      },
      required: ['id'],
      additionalProperties: false,
    },
    run: async args => {
      if (!options.projectDir) return reply(t('No project is open. Open one with open_project'), true)
      const dir = options.projectDir
      const doc = ledgerDocument(await loadProject(dir), str(args.id))
      if (!doc) return reply(t('{id} is not a document named in the ledger (only files in the source column of ledger rows can be read)', { id: str(args.id) }), true)
      const versions = await docVersions(dir, doc.file)
      const base = diffBase(doc, versions, str(args.from))
      const listed = versionsText(doc, versions)
      if (!base) return reply(`${listed}\n\n${t('No diff (no approval on record): pass from (a commit ID) to see one')}`)
      try {
        const diff = await docDiff(dir, doc.file, base.commit, str(args.to) || undefined)
        return reply(`${listed}\n\n${t('Diff {why}:', { why: base.why })}\n${diff || t('(no change)')}`)
      } catch (error: unknown) {
        return reply(`${listed}\n\n${t('Could not read the diff: {message}', { message: error instanceof Error ? error.message : String(error) })}`, true)
      }
    },
  }]
}
