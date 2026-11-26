import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { tsvSignature } from '../src/watch.js'

describe('tsvSignature（見張りの知らせが届かない置き場所のための見比べ）', () => {
  let dir = ''
  afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }) })

  test('TSV が書き換わると変わり、TSV でないファイルや .git の中が変わっても変わらない', async () => {
    dir = await mkdtemp(join(tmpdir(), 'tadori-watch-'))
    await mkdir(join(dir, '.tadori', 'daily'), { recursive: true })
    await mkdir(join(dir, '.git'), { recursive: true })
    await writeFile(join(dir, '.tadori', 'daily', '2026-11-26.tsv'), 'id\twho\n')
    const before = await tsvSignature(dir)
    await writeFile(join(dir, 'notes.md'), '# メモ')
    await writeFile(join(dir, '.git', 'x.tsv'), 'a')
    expect(await tsvSignature(dir)).toBe(before)
    await writeFile(join(dir, '.tadori', 'daily', '2026-11-26.tsv'), 'id\twho\nm1\t設計担当\n')
    expect(await tsvSignature(dir)).not.toBe(before)
  })
})
