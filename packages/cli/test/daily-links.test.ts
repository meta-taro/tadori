import { describe, expect, test } from 'vitest'
import { shortOf, type DailyEntry, type Item, type Task } from '@tadori/core'
import { DEFAULT_DAILY_FORMAT } from '../src/daily-format.js'
import { issueLinksOf, linksOf } from '../src/daily.js'

const row = (id: string, over: Partial<DailyEntry>): DailyEntry => ({ id, who: '設計担当', section: 'today', text: '', wbs: [], origin: 'manual', ...over })
const task = (id: string, url?: string): Task => ({ id, phase: 'P1', name: id, status: 'doing', ...(url ? { url } : {}) })
const item = (id: string, fields: Record<string, string>): Item => ({ id, kind: 'Q', title: id, source: '', refs: [], fields })

describe('WBS の札から正本の工程表の行へ', () => {
  test('wbs.tsv に url のある作業は正本の行へ飛ぶ。ほかの作業に url がある案件で url の無い作業は「想定」と見分ける', () => {
    const links = linksOf([row('m1', { wbs: ['W-01', 'W-02'] })], DEFAULT_DAILY_FORMAT, [task('W-01', 'https://sheets.example.com/wbs#range=A12'), task('W-02')])
    expect(links).toContainEqual({ text: 'W-01', href: 'https://sheets.example.com/wbs#range=A12', external: true })
    expect(links).toContainEqual({ text: 'W-02', href: '#browse-W-02', assumed: true })
  })

  test('どの作業にも url が無い案件は、今までどおり tadori の中の WBS へ飛び、想定の印も出さない', () => {
    expect(linksOf([row('m1', { wbs: ['W-02'] })], DEFAULT_DAILY_FORMAT, [task('W-02')])).toContainEqual({ text: 'W-02', href: '#browse-W-02' })
  })
})

describe('課題の正本の WBS の行（issue_link_field）', () => {
  const items = [item('BL943', { wbs_url: 'https://sheets.example.com/wbs#range=A7' }), item('BL950', { wbs_url: '' })]
  const entries = [row('m1', { issue: 'BL943' }), row('m2', { issue: 'BL950' }), row('m3', { issue: 'BL999' }), row('m4', {})]

  test('決めた列の URL を課題ごとに出し、URL の無い課題（台帳に無い課題も）を挙げる', () => {
    const format = { ...DEFAULT_DAILY_FORMAT, issue_link_field: 'wbs_url' }
    expect(issueLinksOf(items, entries, format)).toEqual({
      issueLinkField: 'wbs_url',
      issueLinks: { BL943: { label: 'WBS', url: 'https://sheets.example.com/wbs#range=A7' } },
      missingIssueLinks: ['BL950', 'BL999'],
    })
  })

  test('列を決めていない案件では、何も出さず、知らせもしない', () => {
    expect(issueLinksOf(items, entries, DEFAULT_DAILY_FORMAT)).toEqual({ issueLinks: {}, missingIssueLinks: [], issueLinkField: '' })
  })
})

describe('shortOf（行の頭の「課題番号 短い名前」が重ならないように）', () => {
  test('short が課題番号で始まっていれば外す。始まっていなければそのまま', () => {
    expect(shortOf('BL943', 'BL943 画面の改修')).toBe('画面の改修')
    expect(shortOf('BL943', '画面の改修')).toBe('画面の改修')
    expect(shortOf('BL943', undefined)).toBe('')
  })
})
