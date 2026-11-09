import { readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  loadProject, removeItem, removeMember, removeRule, saveItem, saveMember, saveRule, saveSettings, saveTask,
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
const committed = (c: CommitResult) => (c.committed ? 'commit しました（push は人）' : (c.reason ?? ''))

/** 案件を確かめてから書く。断られたら理由を isError で返す */
async function writing(ctx: WriteContext, done: string, work: (dir: string) => Promise<CommitResult>): Promise<ToolResult> {
  if (!ctx.projectDir) return reply('開く案件が決まっていません。open_project で開いてください', true)
  try {
    return reply(`${done}。${committed(await work(ctx.projectDir))}`)
  } catch (error: unknown) {
    if (error instanceof WriteRefused) return reply(`書きませんでした（ファイルは元のまま）：\n- ${error.problems.join('\n- ')}`, true)
    throw error
  }
}

/** 文字の項目だけを取り出す（渡されなかった項目は変えない） */
function pick(args: Record<string, unknown>, keys: readonly string[]): Record<string, string> {
  return Object.fromEntries(keys.flatMap(k => (str(args[k]) !== undefined ? [[k, str(args[k]) as string]] : [])))
}

const S = (description: string) => ({ type: 'string', description })
const ITEM = { id: S('行の ID'), kind: S('種類（例：DD・TC・RUN）'), title: S('名前'), source: S('原本の場所（中身は写さない）'), refs: { type: 'array', items: { type: 'string' }, description: '元にしている行の ID（台帳にあるものだけ）' }, fields: { type: 'object', additionalProperties: { type: 'string' }, description: 'そのほかの列（例：{"change":"変わる"}）' } }
const TASK = { id: S('作業の ID（W で始める）'), phase: S('工程の ID'), name: S('作業の名前'), start: S('開始日 YYYY-MM-DD'), end: S('終了日 YYYY-MM-DD'), status: S('状態（設定にあるもの）'), owner: S('担当（2 人以上は「A・B」）'), issue: S('課題の ID（台帳の行）') }
const RULE = { id: S('ルールの ID'), phase: S('工程の ID'), kind: S('covered・refers・filled・approval'), from: S('元の種類'), to: S('先の種類'), field: S('filled で見る列'), only: S('対象を絞る「列名=値」'), owner: S('直す担当（役割）'), label: S('人が読む一文') }

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
  return [
    {
      name: 'item_add',
      description: '台帳（ledger/items.tsv）に行を足す。refs は台帳にある ID だけ（推測でつながない）。source には原本の場所だけを書き、中身を写さない。',
      inputSchema: { type: 'object', properties: ITEM, required: ['id', 'kind', 'title'], additionalProperties: false },
      run: async a => writing(ctx, `台帳に ${str(a.id)} を足しました`, dir => saveItem(dir, { ...pick(a, ['id', 'kind', 'title', 'source']), id: str(a.id) ?? '', ...(list(a.refs) ? { refs: list(a.refs) as string[] } : {}), ...(a.fields ? { fields: a.fields as Record<string, string> } : {}) }, { create: true })),
    },
    {
      name: 'item_update',
      description: '台帳の行を直す（渡した項目だけ変わる）。',
      inputSchema: { type: 'object', properties: ITEM, required: ['id'], additionalProperties: false },
      run: async a => writing(ctx, `台帳の ${str(a.id)} を直しました`, dir => saveItem(dir, { ...pick(a, ['kind', 'title', 'source']), id: str(a.id) ?? '', ...(list(a.refs) ? { refs: list(a.refs) as string[] } : {}), ...(a.fields ? { fields: a.fields as Record<string, string> } : {}) }, { create: false })),
    },
    {
      name: 'item_remove',
      description: '台帳の行を消す。ほかの行の refs や WBS の issue が指している行は消さない（つながりが切れるため）。',
      inputSchema: { type: 'object', properties: { id: ITEM.id }, required: ['id'], additionalProperties: false },
      run: async a => writing(ctx, `台帳の ${str(a.id)} を消しました`, dir => removeItem(dir, str(a.id) ?? '')),
    },
    {
      name: 'task_add',
      description: 'WBS（ledger/wbs.tsv）に作業を足す。',
      inputSchema: { type: 'object', properties: TASK, required: ['id', 'phase', 'name', 'status'], additionalProperties: false },
      run: async a => writing(ctx, `WBS に ${str(a.id)} を足しました`, dir => saveTask(dir, { ...pick(a, Object.keys(TASK)), id: str(a.id) ?? '' }, { create: true })),
    },
    {
      name: 'task_update',
      description: 'WBS の作業の状態・日付・担当・課題などを直す（その場で commit するので、1 日の進行の「状態が変わった日」がずれない）。',
      inputSchema: { type: 'object', properties: TASK, required: ['id'], additionalProperties: false },
      run: async a => writing(ctx, `WBS の ${str(a.id)} を直しました`, dir => saveTask(dir, { ...pick(a, Object.keys(TASK)), id: str(a.id) ?? '' }, { create: false })),
    },
    {
      name: 'rule_add',
      description: 'ルールを足す（.tadori/rulesets/rules.tsv）。判定は covered・refers・filled・approval。',
      inputSchema: { type: 'object', properties: RULE, required: ['id', 'phase', 'kind', 'label'], additionalProperties: false },
      run: async a => writing(ctx, `ルール ${str(a.id)} を足しました`, dir => saveRule(dir, { ...pick(a, Object.keys(RULE)), id: str(a.id) ?? '' }, { create: true })),
    },
    {
      name: 'rule_update',
      description: 'ルールを直す（書かれているファイルのまま）。',
      inputSchema: { type: 'object', properties: RULE, required: ['id'], additionalProperties: false },
      run: async a => writing(ctx, `ルール ${str(a.id)} を直しました`, dir => saveRule(dir, { ...pick(a, Object.keys(RULE)), id: str(a.id) ?? '' }, { create: false })),
    },
    {
      name: 'rule_remove',
      description: 'ルールを消す。',
      inputSchema: { type: 'object', properties: { id: RULE.id }, required: ['id'], additionalProperties: false },
      run: async a => writing(ctx, `ルール ${str(a.id)} を消しました`, dir => removeRule(dir, str(a.id) ?? '')),
    },
    {
      name: 'member_set',
      description: '人の表（.tadori/members.tsv）に人を足すか直す。roles はその人の役割（ルールの担当と同じ書き方）、git は git の作者名。',
      inputSchema: { type: 'object', properties: { name: S('人の名前（WBS の担当と同じ書き方）'), git: S('git の作者名'), roles: { type: 'array', items: { type: 'string' } } }, required: ['name'], additionalProperties: false },
      run: async a => writing(ctx, `人の表の ${str(a.name)} を直しました`, dir => saveMember(dir, { name: str(a.name) ?? '', ...(str(a.git) !== undefined ? { git: str(a.git) as string } : {}), ...(list(a.roles) ? { roles: list(a.roles) as string[] } : {}) })),
    },
    {
      name: 'member_remove',
      description: '人の表から人を消す。',
      inputSchema: { type: 'object', properties: { name: S('人の名前') }, required: ['name'], additionalProperties: false },
      run: async a => writing(ctx, `人の表から ${str(a.name)} を消しました`, dir => removeMember(dir, str(a.name) ?? '')),
    },
    {
      name: 'phase_set',
      description: '工程を足すか、名前・順番を直す（.tadori/phases.tsv）。使われている工程は消せない。',
      inputSchema: { type: 'object', properties: { id: S('工程の ID（英数字）'), name: S('工程の名前'), order: { type: 'number', description: '並び（小さいほど前）' } }, required: ['id', 'name'], additionalProperties: false },
      run: async a => writing(ctx, `工程 ${str(a.id)} を直しました`, async dir => {
        const project = await loadProject(dir)
        const id = str(a.id) ?? ''
        const order = typeof a.order === 'number' ? a.order : (project.phases.find(p => p.id === id)?.order ?? Math.max(0, ...project.phases.map(p => p.order)) + 1)
        const next = [...project.phases.filter(p => p.id !== id), { id, name: str(a.name) ?? '', order }].sort((x, y) => x.order - y.order)
        const problems = validatePhases(project, next)
        if (problems.length) throw new WriteRefused(problems)
        return saveSettings(dir, { phases: next }, `工程 ${id} を直した`)
      }),
    },
    {
      name: 'run_check',
      description: 'check を回す。log を付けると、チェックの記録（.tadori/checks.tsv・5W1H）に足して commit する。who は確かめた人（エージェントなら自分の名前）、why は理由。',
      inputSchema: { type: 'object', properties: { log: { type: 'boolean' }, who: S('確かめた人'), why: S('理由（例：夕会の前）') }, additionalProperties: false },
      run: async a => {
        if (!ctx.projectDir) return reply('開く案件が決まっていません。open_project で開いてください', true)
        const run = await runCheck(ctx.projectDir, { today: ctx.today ?? localToday(), ...(a.log === true ? { log: true } : {}), ...(str(a.who) ? { who: str(a.who) as string } : {}), ...(str(a.why) ? { why: str(a.why) as string } : {}) })
        return reply(`${run.text}${run.commit ? `\n\nチェックの記録を足しました。${committed(run.commit)}` : ''}`)
      },
    },
    {
      name: 'list_projects',
      description: 'いま開いている案件と、デスクトップアプリの最近の案件を並べる。',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      run: async () => {
        let recent: string[] = []
        try {
          recent = (await readFile(recentFile(), 'utf8')).replace(/^﻿/, '').split(/\r?\n/).map(s => s.trim()).filter(Boolean)
        } catch {
          // デスクトップアプリを使っていない PC：最近の案件は無い
        }
        const lines = [...new Set([...(ctx.projectDir ? [ctx.projectDir] : []), ...recent])].map(p => `- ${p}${p === ctx.projectDir ? '（いま開いている）' : ''}`)
        return reply(lines.length ? lines.join('\n') : '案件がありません。open_project で開いてください')
      },
    },
    {
      name: 'open_project',
      description: 'この MCP の口で扱う案件を替える（.tadori のあるフォルダ）。以後の道具はその案件を読み書きする。',
      inputSchema: { type: 'object', properties: { path: S('案件のフォルダ') }, required: ['path'], additionalProperties: false },
      run: async a => {
        const dir = resolve(str(a.path) ?? '')
        if (!(await isProject(dir))) return reply(`${dir} には .tadori がありません。新しく始めるなら tadori init で`, true)
        ctx.projectDir = dir
        return reply(`${dir} を開きました`)
      },
    },
  ]
}
