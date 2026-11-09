import { afterAll, describe, expect, test } from 'vitest'
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readBuildInfo } from '../src/build-info.js'

const made: string[] = []
afterAll(async () => { for (const d of made) await rm(d, { recursive: true, force: true }) })

describe('readBuildInfo（server が建てたあとに、元のコードが直されていないか）', () => {
  test('建てた時刻より新しい元のコードがあれば isStale。元のコードが無い（配る版）なら isStale にしない', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tadori-build-'))
    made.push(root)
    await mkdir(join(root, 'dist'), { recursive: true })
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(join(root, 'dist/build-info.json'), JSON.stringify({ builtAt: '2026-11-09T07:00:00.000Z', commit: 'abc1234' }))
    expect(await readBuildInfo(join(root, 'dist'), [])).toEqual({ builtAt: '2026-11-09T07:00:00.000Z', commit: 'abc1234', isStale: false })
    await writeFile(join(root, 'src/a.ts'), 'x')
    await utimes(join(root, 'src/a.ts'), new Date('2026-11-09T08:00:00Z'), new Date('2026-11-09T08:00:00Z'))
    expect((await readBuildInfo(join(root, 'dist'), [join(root, 'src')])).isStale).toBe(true)
    await utimes(join(root, 'src/a.ts'), new Date('2026-11-09T06:00:00Z'), new Date('2026-11-09T06:00:00Z'))
    expect((await readBuildInfo(join(root, 'dist'), [join(root, 'src')])).isStale).toBe(false)
  })

  test('build-info.json が無ければ、分からないことを返す（古いとは言わない）', async () => {
    expect(await readBuildInfo(join(tmpdir(), 'tadori-none-xyz'), [])).toEqual({ builtAt: '', commit: '', isStale: false })
  })
})
