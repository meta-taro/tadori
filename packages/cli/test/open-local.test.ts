import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { addDaily } from '../src/daily.js'
import { assertOpenable, isLocalRef, localPathOf, openLocalLink, OpenLocalError, parseLocalLinkRef } from '../src/open-local.js'

// 架空の最小の案件。手元のフォルダ・ファイルのリンクは、台帳に書いたものだけを、確かめてから開く
let dir = ''
let local = ''
const day = '2026-11-12'
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tadori-open-'))
  local = await mkdtemp(join(tmpdir(), 'tadori-手元-'))
  await mkdir(join(local, 'パターン PDF'), { recursive: true })
  await writeFile(join(local, 'a.pdf'), 'x')
  await writeFile(join(local, 'run.exe'), 'x')
  const put = async (path: string, text: string) => {
    await mkdir(join(dir, path, '..'), { recursive: true })
    await writeFile(join(dir, path), text, 'utf8')
  }
  const folder = pathToFileURL(join(local, 'パターン PDF')).href
  await put('.tadori/project.tsv', 'name\n架空の案件\n')
  await put('.tadori/phases.tsv', 'id\tname\torder\nit\t結合試験\t1\n')
  await put('.tadori/statuses.tsv', 'id\tname\ttone\ntodo\t未着手\tnone\ndone\t完了\tok\n')
  await put('.tadori/rulesets/it.tsv', 'id\tphase\tkind\tfrom\tto\tfield\tlabel\nR1\tit\tapproval\t\t\t\t結合試験を承認した\n')
  await put('ledger/items.tsv', 'id\tkind\ttitle\tsource\trefs\n')
  await put('ledger/wbs.tsv', `id\tphase\tname\tstart\tend\tstatus\tlinks\nW-1\tit\t結合試験\t\t\ttodo\tパターン PDF（手元） ${folder} > パターン | 共有 https://drive.example.com/p | 実行 ${pathToFileURL(join(local, 'run.exe')).href}\n`)
})
afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
  await rm(local, { recursive: true, force: true })
})

describe('手元のフォルダ・ファイルのリンク', () => {
  test('file:/// の URL（%エンコードした日本語・空白も戻す）と C:\\ の Windows のパスを読む。ネットワークのパス・http は手元としない', () => {
    expect(isLocalRef('file:///C:/work/pdf')).toBe(true)
    expect(isLocalRef('C:\\work\\竹中【試験】～')).toBe(true)
    expect(isLocalRef('https://example.com')).toBe(false)
    expect(localPathOf('C:\\work\\竹中【試験】～')).toBe('C:\\work\\竹中【試験】～')
    expect(localPathOf('file:///C:/work/%E7%AB%B9%E4%B8%AD%20pdf')).toBe('C:\\work\\竹中 pdf')
    expect(localPathOf('file://server/share/x')).toBeUndefined()
    expect(localPathOf('\\\\server\\share')).toBeUndefined()
  })

  test('フォルダと決まった種類のファイルだけを開いてよい。無いもの・実行ファイルは理由つきで止める', async () => {
    await expect(assertOpenable(join(local, 'パターン PDF'))).resolves.toBeUndefined()
    await expect(assertOpenable(join(local, 'a.pdf'))).resolves.toBeUndefined()
    await expect(assertOpenable(join(local, 'run.exe'))).rejects.toThrow(OpenLocalError)
    await expect(assertOpenable(join(local, 'none'))).rejects.toThrow(OpenLocalError)
  })

  test('WBS の作業の何本目かで引き、手元のフォルダなら OS に開かせる。http や実行ファイルのリンクは開かない', async () => {
    const opened: string[] = []
    const opener = async (path: string) => { opened.push(path) }
    expect(await openLocalLink(dir, { kind: 'task', id: 'W-1', index: 0 }, opener)).toBe(join(local, 'パターン PDF'))
    await expect(openLocalLink(dir, { kind: 'task', id: 'W-1', index: 1 }, opener)).rejects.toThrow(OpenLocalError)
    await expect(openLocalLink(dir, { kind: 'task', id: 'W-1', index: 2 }, opener)).rejects.toThrow(OpenLocalError)
    await expect(openLocalLink(dir, { kind: 'task', id: 'W-9', index: 0 }, opener)).rejects.toThrow(OpenLocalError)
    expect(opened).toEqual([join(local, 'パターン PDF')])
  })

  test('1 日の進行の行の links にも手元のパスを書け、その行の何本目かで開く。空白入りのパスは断る', async () => {
    const { entry } = await addDaily(dir, day, { section: 'today', text: '結果を置いた', links: [{ label: '結果', url: pathToFileURL(join(local, 'a.pdf')).href }] })
    const opened: string[] = []
    await openLocalLink(dir, { kind: 'daily', date: day, entry: entry.id, index: 0 }, async path => { opened.push(path) })
    expect(opened).toEqual([join(local, 'a.pdf')])
    await expect(addDaily(dir, day, { section: 'today', text: 'x', links: [{ label: 'x', url: 'C:\\my folder' }] })).rejects.toThrow()
  })

  test('画面から受けるのは「どの行の何本目か」だけ。パスそのものは受けない', () => {
    expect(parseLocalLinkRef({ kind: 'task', id: 'W-1', index: 0 })).toEqual({ kind: 'task', id: 'W-1', index: 0 })
    expect(() => parseLocalLinkRef({ path: 'C:\\Windows' })).toThrow(OpenLocalError)
    expect(() => parseLocalLinkRef({ kind: 'daily', date: 'today', entry: 'm1', index: 0 })).toThrow(OpenLocalError)
  })
})
