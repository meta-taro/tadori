import { afterAll, describe, expect, test } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { appendServerError, defaultLogDir, readServerErrors } from '../src/error-log.js'

const made: string[] = []
afterAll(async () => { for (const d of made) await rm(d, { recursive: true, force: true }) })
const dirOf = async () => { const d = await mkdtemp(join(tmpdir(), 'tadori-log-')); made.push(d); return d }

describe('server の例外の記録', () => {
  test('日付ごとのファイルに 1 行 1 件（JSON）で足し、新しい順に読める。本文は残さない', async () => {
    const dir = await dirOf()
    const at = new Date('2026-11-09T07:00:00Z')
    const file = await appendServerError(dir, { at, method: 'GET', path: '/api/daily', project: 'C:/work/a', error: new TypeError('x is not a function') })
    expect(file).toMatch(/server-2026-11-09\.log$/)
    await appendServerError(dir, { at: new Date('2026-11-09T07:05:00Z'), method: 'POST', path: '/api/rules', project: 'C:/work/a', error: new Error('second') })
    const lines = (await readFile(file, 'utf8')).trim().split('\n')
    expect(lines).toHaveLength(2)
    expect(JSON.parse(lines[0] as string)).toMatchObject({ method: 'GET', path: '/api/daily', name: 'TypeError', message: 'x is not a function' })
    const recent = await readServerErrors(dir, 1)
    expect(recent).toHaveLength(1)
    expect(recent[0]).toMatchObject({ path: '/api/rules', message: 'second' })
  })

  test('記録が無ければ空。置き場所は TADORI_LOG_DIR が先', async () => {
    expect(await readServerErrors(await dirOf(), 10)).toEqual([])
    expect(defaultLogDir({ TADORI_LOG_DIR: 'D:/logs' }, 'win32', 'C:/Users/u')).toBe('D:/logs')
    expect(defaultLogDir({ LOCALAPPDATA: 'C:/Users/u/AppData/Local' }, 'win32', 'C:/Users/u')).toBe(join('C:/Users/u/AppData/Local', 'tadori', 'logs'))
    expect(defaultLogDir({}, 'darwin', '/Users/u')).toBe(join('/Users/u', 'Library', 'Logs', 'tadori'))
  })
})
