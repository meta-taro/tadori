// ハーネスの共通の道具：組んだ CLI を本物のプロセスとして起こす
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { createInterface } from 'node:readline'

export const ROOT = resolve(import.meta.dirname, '..')
// 既定はリポジトリで組んだ CLI。TADORI_HARNESS_CLI を渡すと、インストーラーに入れる写し（packages/desktop/src-tauri/tadori）を試す
export const CLI = process.env.TADORI_HARNESS_CLI ? resolve(process.env.TADORI_HARNESS_CLI) : resolve(ROOT, 'packages/cli/dist/main.js')
export const EXAMPLE = resolve(ROOT, 'examples/lend-v12')

/** 試験の中では、言語を日本語に固め、新しい版を見に外へ出ない。git の環境変数は外す（commit 前の検査の中で走っても、このリポジトリを触らない） */
export function harnessEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_') && key !== 'TADORI_APP_VERSION'))
  return { ...env, TADORI_LANG: 'ja', TADORI_UPDATE_CHECK: 'off', ...extra }
}

/** 組んだ CLI が無ければ、ここで止める（組まずに流して、古い dist を試すのを防ぐ） */
export function requireBuilt(): { commit: string; builtAt: string } {
  if (!existsSync(CLI)) throw new Error(`組んだ CLI がありません：${CLI}。pnpm build してから流してください`)
  return JSON.parse(readFileSync(resolve(dirname(CLI), 'build-info.json'), 'utf8')) as { commit: string; builtAt: string }
}

/** CLI を 1 回動かして、終了コードと出力を返す */
export function runCli(args: readonly string[], cwd = ROOT): { code: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [CLI, ...args], { cwd, env: harnessEnv(), encoding: 'utf8' })
  return { code: result.status, stdout: result.stdout, stderr: result.stderr }
}

interface McpClient {
  request(method: string, params?: unknown): Promise<{ result?: any; error?: { message: string } }>
  close(): void
}

/** MCP を本物のプロセス（標準入出力・1 行 1 通）で起こす */
export function startMcp(args: readonly string[]): McpClient {
  const child = spawn(process.execPath, [CLI, 'mcp', ...args], { env: harnessEnv(), stdio: ['pipe', 'pipe', 'pipe'] })
  const waiting = new Map<number, (message: any) => void>()
  createInterface({ input: child.stdout }).on('line', line => {
    const message = JSON.parse(line) as { id: number }
    waiting.get(message.id)?.(message)
    waiting.delete(message.id)
  })
  let next = 1
  return {
    request(method, params = {}) {
      const id = next++
      return new Promise(done => {
        waiting.set(id, done)
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
      })
    },
    close() { child.kill() },
  }
}

/** serve を本物のプロセスで起こし、立ち上がった URL を返す */
export async function startServe(project: string, extraEnv: Record<string, string> = {}): Promise<{ url: string; close(): void }> {
  const child = spawn(process.execPath, [CLI, 'serve', project, '--port', '0'], { env: harnessEnv(extraEnv), stdio: ['ignore', 'pipe', 'pipe'] })
  let errors = ''
  child.stderr.on('data', chunk => { errors += String(chunk) })
  const url = await new Promise<string>((done, fail) => {
    const timer = setTimeout(() => fail(new Error(`serve が立ち上がりません：${errors}`)), 15_000)
    createInterface({ input: child.stdout }).on('line', line => {
      const found = line.match(/https?:\/\/127\.0\.0\.1:\d+\//)
      if (found) { clearTimeout(timer); done(found[0]) }
    })
    child.on('exit', code => { clearTimeout(timer); fail(new Error(`serve が終わりました（${code}）：${errors}`)) })
  })
  return { url, close: () => child.kill() }
}
