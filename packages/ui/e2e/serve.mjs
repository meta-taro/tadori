// 画面のテスト用に、架空の見本を一時フォルダへ写してから tadori serve を起こす。
// テストが行を足したり直したりしても、リポジトリの見本（examples/lend-v12）は書き換わらない。
import { spawn } from 'node:child_process'
import { cp, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const port = process.argv[2] ?? '4987'
const here = import.meta.dirname
const example = resolve(here, '../../../examples/lend-v12')
const dir = await mkdtemp(join(tmpdir(), 'tadori-e2e-'))
await cp(example, dir, { recursive: true })

const server = spawn(process.execPath, [resolve(here, '../../cli/dist/main.js'), 'serve', dir, '--port', port], { stdio: 'inherit' })
const cleanup = async () => {
  server.kill()
  await rm(dir, { recursive: true, force: true })
  process.exit(0)
}
process.on('SIGINT', cleanup)
process.on('SIGTERM', cleanup)
server.on('exit', code => { void rm(dir, { recursive: true, force: true }).then(() => process.exit(code ?? 0)) })
