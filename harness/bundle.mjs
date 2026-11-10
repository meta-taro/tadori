// インストーラーに入れる写し（packages/desktop/src-tauri/tadori）を並べ、その写しで出す前の試験を流す。
// リポジトリで組んだ CLI が通っても、写し方（並び・入れ忘れ）が崩れていれば、配った版だけが動かないため
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const run = (command, args, env = {}) => {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32', env: { ...process.env, ...env } })
  if (result.status !== 0) process.exit(result.status ?? 1)
}
run('node', ['packages/desktop/scripts/stage.mjs'])
run('pnpm', ['exec', 'vitest', 'run', '--config', 'harness/vitest.config.ts'], { TADORI_HARNESS_CLI: resolve(root, 'packages/desktop/src-tauri/tadori/cli/dist/main.js') })
