// インストーラーに入れる tadori の本体を、src-tauri/tadori/ に並べる（Tauri がそのまま resources に入れる）。
// 並び方はリポジトリと同じにする。CLI は自分の場所から ../../ui/static と ../guide.md を探すので、並びを変えると画面が出ない。
//
//   tadori/cli/dist/*.js            CLI（tadori serve・init・mcp）
//   tadori/cli/guide.md             使い方（MCP の how_to）
//   tadori/cli/package.json         ES modules として読ませるため（"type": "module"）
//   tadori/node_modules/@tadori/core 判定の核（実行時の依存は無いので、そのまま写せば動く）
//   tadori/ui/static/               画面
//
// 新しい依存（バンドラ）を足さずに済むよう、ビルド済みのファイルを写すだけにしている。
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const packages = join(here, '..', '..')
const out = join(here, '..', 'src-tauri', 'tadori')

/** 型の宣言と対応表は、動かすのに要らないので入れない */
const runtimeOnly = source => !/\.(d\.ts|map)$/.test(source)

async function copyDir(from, to) {
  await cp(from, to, { recursive: true, filter: runtimeOnly })
}

async function packageJson(from, to, keep) {
  const pkg = JSON.parse(await readFile(from, 'utf8'))
  const slim = Object.fromEntries(keep.filter(k => k in pkg).map(k => [k, pkg[k]]))
  await writeFile(to, `${JSON.stringify(slim, null, 2)}\n`, 'utf8')
}

await rm(out, { recursive: true, force: true })
await mkdir(join(out, 'cli'), { recursive: true })
await mkdir(join(out, 'node_modules', '@tadori', 'core'), { recursive: true })

await copyDir(join(packages, 'cli', 'dist'), join(out, 'cli', 'dist'))
// 使い方は英語（guide.md）と日本語（guide.ja.md）の両方を入れる（言語に合わせて how_to が選ぶ）
await cp(join(packages, 'cli', 'guide.md'), join(out, 'cli', 'guide.md'))
await cp(join(packages, 'cli', 'guide.ja.md'), join(out, 'cli', 'guide.ja.md'))
await packageJson(join(packages, 'cli', 'package.json'), join(out, 'cli', 'package.json'), ['name', 'version', 'type', 'license'])

await copyDir(join(packages, 'core', 'dist'), join(out, 'node_modules', '@tadori', 'core', 'dist'))
await packageJson(join(packages, 'core', 'package.json'), join(out, 'node_modules', '@tadori', 'core', 'package.json'), ['name', 'version', 'type', 'main', 'exports', 'license'])

await copyDir(join(packages, 'ui', 'static'), join(out, 'ui', 'static'))

process.stdout.write(`tadori の本体を並べました：${out}\n`)
