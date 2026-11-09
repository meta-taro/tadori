// 建てた時刻と commit を dist/build-info.json に残す（画面と server の版が食い違っていないかを確かめるため）
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

let commit = ''
try {
  commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim()
} catch {
  // git の外で建てたときは commit を空にする（建てた時刻だけで見分ける）
}
writeFileSync(resolve(import.meta.dirname, '../dist/build-info.json'), `${JSON.stringify({ builtAt: new Date().toISOString(), commit }, null, 2)}\n`)
