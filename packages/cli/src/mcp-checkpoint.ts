import './i18n.js'
import { t, WriteRefused } from '@tadori/core'
import { answersOf, checkpointListText, checklistText, recordCheckpoint, RESULT_VALUES } from './checkpoint.js'
import { committed } from './mcp-write.js'

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

/** 節目のチェックの道具。案件は options.projectDir（open_project で替わる）を読む */
export function checkpointTools(options: { projectDir?: string }): Tool[] {
  const withDir = async (work: (dir: string) => Promise<ToolResult>): Promise<ToolResult> => {
    if (!options.projectDir) return reply(t('No project is open. Open one with open_project'), true)
    return work(options.projectDir)
  }
  const AT = { type: 'string', description: t('Checkpoint ID (e.g. cases-written, before-judge, before-post, before-commit). Omit to list the checkpoints') }
  const TARGET = { type: 'string', description: t('WBS task ID or ledger ID the check is for. Not used for before-commit (the staged change is the target)') }
  return [
    {
      name: 'checkpoint',
      description: t('At a checkpoint in your work (test cases written, before a verdict, before posting outside, before committing), return the rules that apply there as check items, '
        + 'and whether there is already a record for the target. Check every item by looking, then record the results with checkpoint_record. This is not a human approval.'),
      inputSchema: { type: 'object', properties: { at: AT, target: TARGET }, additionalProperties: false },
      run: async args => withDir(async dir => reply(str(args.at) ? await checklistText(dir, { at: str(args.at), target: str(args.target) }) : await checkpointListText(dir))),
    },
    {
      name: 'checkpoint_record',
      description: t('Record the results of every check item at a checkpoint (.tadori/checkpoint-log.tsv, append only, committed). Every item needs a result and where you checked; '
        + 'fixed and open need a note on what was missing and what you did. If any item is missing, nothing is written. '
        + 'The record keeps the ruleset version at that time, so a later defect can be told apart: a rule was missing, or a rule was not applied.'),
      inputSchema: {
        type: 'object',
        properties: {
          at: { ...AT, description: t('Checkpoint ID') },
          target: TARGET,
          who: { type: 'string', description: t('Who checked (your seat name, or the person who asked)') },
          answers: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                rule: { type: 'string' },
                result: { type: 'string', enum: [...RESULT_VALUES], description: t('ok = checked and met / na = does not apply here / fixed = found a miss and fixed it / open = found a miss, not fixed yet') },
                where: { type: 'string', description: t('Where you checked (file:line or ledger ID). For na, why it does not apply') },
                note: { type: 'string', description: t('For fixed and open: what was missing and what you did') },
              },
              required: ['rule', 'result', 'where'],
              additionalProperties: false,
            },
          },
        },
        required: ['at', 'who', 'answers'],
        additionalProperties: false,
      },
      run: async args => withDir(async dir => {
        try {
          const written = await recordCheckpoint(dir, { at: str(args.at), target: str(args.target), who: str(args.who), answers: answersOf(args.answers) })
          return reply(t('Recorded ({target}): {summary}. {commit}', { target: written.target, summary: written.summary, commit: committed(written.commit) }))
        } catch (error: unknown) {
          if (error instanceof WriteRefused) return reply(t('Nothing was written (the files are unchanged):\n- {problems}', { problems: error.problems.join('\n- ') }), true)
          throw error
        }
      }),
    },
  ]
}
