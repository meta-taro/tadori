import { readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import './i18n.js'
import {
  loadProject, removeItem, removeMember, removeRule, saveItem, saveMember, saveRule, saveSettings, saveTask, t,
  validatePhases, WriteRefused, type CommitResult,
} from '@tadori/core'
import { runCheck } from './check-log.js'
import { localToday } from './state.js'

/**
 * MCP の書く道具。エージェントが TSV を直に直さず、形と ID を確かめてから書けるようにする。
 * どれも書いたあとに案件を読み直し、読めなくなる書き方は元に戻して断る。書けたら commit（push は人）。
 * 人の承認（approvals.tsv）を書く道具は作らない（承認するのは人だけ）。
 */

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

/** MCP の口が開いている案件（open_project で替えられる） */
export interface WriteContext {
  projectDir?: string
  today?: string
}

const reply = (body: string, isError = false): ToolResult => ({ content: [{ type: 'text', text: body }], ...(isError ? { isError } : {}) })
const str = (v: unknown) => (typeof v === 'string' ? v : undefined)
const list = (v: unknown) => (Array.isArray(v) ? v.map(String) : undefined)
/** commit したかの一言（MCP の書く道具が共通で使う） */
export const committed = (c: { committed: boolean; reason?: string }): string => (c.committed ? t('Committed (a person pushes)') : (c.reason ?? ''))

/** 案件を確かめてから書く。断られたら理由を isError で返す */
async function writing(ctx: WriteContext, done: string, work: (dir: string) => Promise<CommitResult>): Promise<ToolResult> {
  if (!ctx.projectDir) return reply(t('No project is open. Open one with open_project'), true)
  try {
    return reply(t('{done}. {commit}', { done, commit: committed(await work(ctx.projectDir)) }))
  } catch (error: unknown) {
    if (error instanceof WriteRefused) return reply(t('Nothing was written (the files are unchanged):\n- {problems}', { problems: error.problems.join('\n- ') }), true)
    throw error
  }
}

/** 文字の項目だけを取り出す（渡されなかった項目は変えない） */
function pick(args: Record<string, unknown>, keys: readonly string[]): Record<string, string> {
  return Object.fromEntries(keys.flatMap(k => (str(args[k]) !== undefined ? [[k, str(args[k]) as string]] : [])))
}

/** 手元の日時を YYYY-MM-DD HH:MM で返す（正本から反映した記録に使う） */
export function localMinute(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${localToday(now)} ${pad(now.getHours())}:${pad(now.getMinutes())}`
}

/** 反映した人が渡されたら、いまの日時と組にして saveItem の synced にする */
function syncedBy(who: unknown): { synced?: { at: string; who: string } } {
  const name = str(who)?.trim()
  return name ? { synced: { at: localMinute(), who: name } } : {}
}

// 道具の説明はエージェントが読む。tools/list のたびに組み立て、そのときの言語の文にする
const S = (description: string) => ({ type: 'string', description })
const itemSchema = () => ({
  id: S(t('Row ID')), kind: S(t('Kind (e.g. DD, TC, RUN)')), title: S(t('Name')), source: S(t('Where the original lives (do not copy its contents)')),
  refs: { type: 'array', items: { type: 'string' }, description: t('IDs of the rows this one is based on (only IDs in the ledger)') },
  fields: { type: 'object', additionalProperties: { type: 'string' }, description: t('Other columns (e.g. {"change":"yes"})') },
})
const TASK_KEYS = ['id', 'phase', 'name', 'start', 'end', 'status', 'owner', 'issue'] as const
const taskSchema = () => ({
  id: S(t('Task ID (starts with W)')), phase: S(t('Phase ID')), name: S(t('Task name')), start: S(t('Start date YYYY-MM-DD')), end: S(t('End date YYYY-MM-DD')),
  status: S(t('Status (one from the settings)')), owner: S(t('Owner (for two or more, "A・B")')), issue: S(t('Issue ID (a ledger row)')),
})
const RULE_KEYS = ['id', 'phase', 'kind', 'from', 'to', 'field', 'only', 'values', 'group', 'owner', 'label'] as const
const ruleSchema = () => ({
  id: S(t('Rule ID')), phase: S(t('Phase ID')), kind: S(t('covered, refers, filled, allowed or approval, or note (a written agreement that is not checked)')), from: S(t('Source kind')), to: S(t('Target kind')),
  field: S(t('Column that filled and allowed check')), only: S(t('Narrow the targets with "column=value", "column=a|b" (any of them) or "column!=value"')), values: S(t('For allowed: the values the column may hold, separated by | (e.g. OK|NG)')), group: S(t('Category ID from .tadori/rule-groups.tsv (empty to remove)')), owner: S(t('Owner who fixes it (a role)')), label: S(t('One sentence for people to read')),
})

/** デスクトップアプリが覚えている最近の案件（OS ごとの置き場所） */
function recentFile(): string {
  const app = 'io.github.meta-taro.tadori'
  if (process.platform === 'win32') return join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), app, 'recent-projects.txt')
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support', app, 'recent-projects.txt')
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), app, 'recent-projects.txt')
}

async function isProject(dir: string): Promise<boolean> {
  try {
    return (await stat(join(dir, '.tadori'))).isDirectory()
  } catch {
    // 無い・読めない場所は案件ではない
    return false
  }
}

export function writeTools(ctx: WriteContext): Tool[] {
  const ITEM = itemSchema()
  const TASK = taskSchema()
  const RULE = ruleSchema()
  return [
    {
      name: 'item_add',
      description: t('Add a row to the ledger (ledger/items.tsv). refs may only use IDs already in the ledger (never link by guessing). Put only the location of the original in source; do not copy its contents.'),
      inputSchema: { type: 'object', properties: ITEM, required: ['id', 'kind', 'title'], additionalProperties: false },
      run: async a => writing(ctx, t('Added {id} to the ledger', { id: str(a.id) ?? '' }), dir => saveItem(dir, { ...pick(a, ['id', 'kind', 'title', 'source']), id: str(a.id) ?? '', ...(list(a.refs) ? { refs: list(a.refs) as string[] } : {}), ...(a.fields ? { fields: a.fields as Record<string, string> } : {}) }, { create: true })),
    },
    {
      name: 'item_update',
      description: t('Edit a ledger row (only the fields you pass change). If you checked the source of truth and brought the row up to date, set synced_by to your name (or the name of the person who asked). The tool fills in the date and time.'),
      inputSchema: { type: 'object', properties: { ...ITEM, synced_by: S(t('Who synced it from the source of truth (writes the current date and time and this name into the synced_at and synced_by columns)')) }, required: ['id'], additionalProperties: false },
      run: async a => writing(ctx, t('Edited {id} in the ledger', { id: str(a.id) ?? '' }), dir => saveItem(dir, { ...pick(a, ['kind', 'title', 'source']), id: str(a.id) ?? '', ...(list(a.refs) ? { refs: list(a.refs) as string[] } : {}), ...(a.fields ? { fields: a.fields as Record<string, string> } : {}) }, { create: false, ...syncedBy(a.synced_by) })),
    },
    {
      name: 'item_synced',
      description: t('Call this after comparing a ledger row with the source of truth and confirming the local row matches it (the contents do not change). Writes the current date and time into synced_at and who into synced_by. On the screen, rows with an old sync stand out.'),
      inputSchema: { type: 'object', properties: { id: ITEM.id, who: S(t('Who checked it (an agent uses its own name)')) }, required: ['id', 'who'], additionalProperties: false },
      run: async a => {
        if (!str(a.who)?.trim()) return reply(t('who (the person who checked) is required'), true)
        return writing(ctx, t('Recorded that {id} in the ledger was synced from the source of truth', { id: str(a.id) ?? '' }), dir => saveItem(dir, { id: str(a.id) ?? '' }, { create: false, ...syncedBy(a.who) }))
      },
    },
    {
      name: 'item_remove',
      description: t("Remove a ledger row. A row that other rows' refs or a WBS issue point to is not removed (that would break the links)."),
      inputSchema: { type: 'object', properties: { id: ITEM.id }, required: ['id'], additionalProperties: false },
      run: async a => writing(ctx, t('Removed {id} from the ledger', { id: str(a.id) ?? '' }), dir => removeItem(dir, str(a.id) ?? '')),
    },
    {
      name: 'task_add',
      description: t('Add a task to the WBS (ledger/wbs.tsv).'),
      inputSchema: { type: 'object', properties: TASK, required: ['id', 'phase', 'name', 'status'], additionalProperties: false },
      run: async a => writing(ctx, t('Added {id} to the WBS', { id: str(a.id) ?? '' }), dir => saveTask(dir, { ...pick(a, TASK_KEYS), id: str(a.id) ?? '' }, { create: true })),
    },
    {
      name: 'task_update',
      description: t('Edit the status, dates, owner, issue and so on of a WBS task (it commits right away, so the "day the status changed" in daily progress stays correct).'),
      inputSchema: { type: 'object', properties: TASK, required: ['id'], additionalProperties: false },
      run: async a => writing(ctx, t('Edited {id} in the WBS', { id: str(a.id) ?? '' }), dir => saveTask(dir, { ...pick(a, TASK_KEYS), id: str(a.id) ?? '' }, { create: false })),
    },
    {
      name: 'rule_add',
      description: t('Add a rule (.tadori/rulesets/rules.tsv). The check kinds are covered, refers, filled, allowed and approval. A note rule is a written agreement (how to write a briefing, a promise between people and agents) that is read, not checked; it needs no phase.'),
      inputSchema: { type: 'object', properties: RULE, required: ['id', 'kind', 'label'], additionalProperties: false },
      run: async a => writing(ctx, t('Added rule {id}', { id: str(a.id) ?? '' }), dir => saveRule(dir, { ...pick(a, RULE_KEYS), id: str(a.id) ?? '' }, { create: true })),
    },
    {
      name: 'rule_update',
      description: t('Edit a rule (in the file it is written in).'),
      inputSchema: { type: 'object', properties: RULE, required: ['id'], additionalProperties: false },
      run: async a => writing(ctx, t('Edited rule {id}', { id: str(a.id) ?? '' }), dir => saveRule(dir, { ...pick(a, RULE_KEYS), id: str(a.id) ?? '' }, { create: false })),
    },
    {
      name: 'rule_remove',
      description: t('Remove a rule.'),
      inputSchema: { type: 'object', properties: { id: RULE.id }, required: ['id'], additionalProperties: false },
      run: async a => writing(ctx, t('Removed rule {id}', { id: str(a.id) ?? '' }), dir => removeRule(dir, str(a.id) ?? '')),
    },
    {
      name: 'member_set',
      description: t("Add or edit a person in the people table (.tadori/members.tsv). roles are the person's roles (written the same way as a rule's owner); git is their git author name."),
      inputSchema: { type: 'object', properties: { name: S(t("The person's name (written the same way as a WBS owner)")), git: S(t('git author name')), roles: { type: 'array', items: { type: 'string' } } }, required: ['name'], additionalProperties: false },
      run: async a => writing(ctx, t('Edited {name} in the people table', { name: str(a.name) ?? '' }), dir => saveMember(dir, { name: str(a.name) ?? '', ...(str(a.git) !== undefined ? { git: str(a.git) as string } : {}), ...(list(a.roles) ? { roles: list(a.roles) as string[] } : {}) })),
    },
    {
      name: 'member_remove',
      description: t('Remove a person from the people table.'),
      inputSchema: { type: 'object', properties: { name: S(t("The person's name")) }, required: ['name'], additionalProperties: false },
      run: async a => writing(ctx, t('Removed {name} from the people table', { name: str(a.name) ?? '' }), dir => removeMember(dir, str(a.name) ?? '')),
    },
    {
      name: 'phase_set',
      description: t('Add a phase, or edit its name or order (.tadori/phases.tsv). A phase that is in use cannot be removed.'),
      inputSchema: { type: 'object', properties: { id: S(t('Phase ID (letters and digits)')), name: S(t('Phase name')), order: { type: 'number', description: t('Order (smaller comes first)') } }, required: ['id', 'name'], additionalProperties: false },
      run: async a => writing(ctx, t('Edited phase {id}', { id: str(a.id) ?? '' }), async dir => {
        const project = await loadProject(dir)
        const id = str(a.id) ?? ''
        const order = typeof a.order === 'number' ? a.order : (project.phases.find(p => p.id === id)?.order ?? Math.max(0, ...project.phases.map(p => p.order)) + 1)
        const next = [...project.phases.filter(p => p.id !== id), { id, name: str(a.name) ?? '', order }].sort((x, y) => x.order - y.order)
        const problems = validatePhases(project, next)
        if (problems.length) throw new WriteRefused(problems)
        return saveSettings(dir, { phases: next }, t('Edit phase {id}', { id }))
      }),
    },
    {
      name: 'run_check',
      description: t('Run check. With log, add the results to the check records (.tadori/checks.tsv, 5W1H) and commit. who is the person who checked (an agent uses its own name); why is the reason.'),
      inputSchema: { type: 'object', properties: { log: { type: 'boolean' }, who: S(t('Who checked')), why: S(t('Reason (e.g. before the evening meeting)')) }, additionalProperties: false },
      run: async a => {
        if (!ctx.projectDir) return reply(t('No project is open. Open one with open_project'), true)
        const run = await runCheck(ctx.projectDir, { today: ctx.today ?? localToday(), ...(a.log === true ? { log: true } : {}), ...(str(a.who) ? { who: str(a.who) as string } : {}), ...(str(a.why) ? { why: str(a.why) as string } : {}) })
        return reply(`${run.text}${run.commit ? `\n\n${t('Added the check records. {commit}', { commit: committed(run.commit) })}` : ''}`)
      },
    },
    {
      name: 'list_projects',
      description: t("List the project open now and the desktop app's recent projects."),
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      run: async () => {
        let recent: string[] = []
        try {
          recent = (await readFile(recentFile(), 'utf8')).replace(/^﻿/, '').split(/\r?\n/).map(s => s.trim()).filter(Boolean)
        } catch {
          // デスクトップアプリを使っていない PC：最近の案件は無い
        }
        const lines = [...new Set([...(ctx.projectDir ? [ctx.projectDir] : []), ...recent])].map(p => `- ${p}${p === ctx.projectDir ? t(' (open now)') : ''}`)
        return reply(lines.length ? lines.join('\n') : t('No projects. Open one with open_project'))
      },
    },
    {
      name: 'open_project',
      description: t('Switch the project this MCP server works on (a folder that has .tadori). Later tools read and write that project.'),
      inputSchema: { type: 'object', properties: { path: S(t('Project folder')) }, required: ['path'], additionalProperties: false },
      run: async a => {
        const dir = resolve(str(a.path) ?? '')
        if (!(await isProject(dir))) return reply(t('{dir} has no .tadori. To start a new project, use tadori init', { dir }), true)
        ctx.projectDir = dir
        return reply(t('Opened {dir}', { dir }))
      },
    },
  ]
}
