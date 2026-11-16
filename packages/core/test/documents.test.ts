import { describe, expect, test } from 'vitest'
import type { Project } from '../src/domain/model.js'
import { ledgerDocument } from '../src/usecase/documents.js'
import { sampleProject } from './fixtures.js'

const project: Project = {
  ...sampleProject,
  items: [
    ...sampleProject.items,
    { id: 'BD-9', kind: 'BD', title: '延滞の章', source: 'docs/basic.md §3', refs: [], fields: {} },
    { id: 'BD-10', kind: 'BD', title: '返済の章', source: 'docs/basic.md §4', refs: [], fields: {} },
    { id: 'L-1', kind: 'L', title: '外の文書', source: 'https://example.com/a', refs: [], fields: {} },
  ],
  rules: [...sampleProject.rules, { id: 'R20', phase: 'bd', kind: 'approval', from: 'BD', to: '', field: '', label: '基本設計の承認' }],
  approvals: [
    { rule: 'R20', status: '承認', who: 'レビュー担当', when: '2026-10-10' },
    { rule: 'R20', status: '承認', who: 'レビュー担当', when: '2026-10-12' },
    { rule: 'R2', status: '差し戻し', who: 'レビュー担当', when: '2026-10-11' },
  ],
}

describe('ledgerDocument', () => {
  test('行の ID からその行の文書を引き、同じ文書を指す行と、その文書を見る承認（承認した最後の日）を返す', () => {
    const doc = ledgerDocument(project, 'BD-9')
    expect(doc?.file).toBe('docs/basic.md')
    expect(doc?.items.map(i => i.id)).toEqual(['BD-9', 'BD-10'])
    expect(doc?.approval).toEqual({ rule: 'R20', when: '2026-10-12' })
  })

  test('文書の場所でも引ける。承認のルールが見ていない文書なら approval は無い', () => {
    const doc = ledgerDocument(project, 'DD-1.md')
    expect(doc?.items.map(i => i.id)).toEqual(['DD-1'])
    expect(doc?.approval).toBeUndefined()
  })

  test('台帳に名前の無いファイル・リンクしか持たない行は引けない（ほかのファイルは読ませない）', () => {
    expect(ledgerDocument(project, 'package.json')).toBeNull()
    expect(ledgerDocument(project, '../secret.txt')).toBeNull()
    expect(ledgerDocument(project, 'L-1')).toBeNull()
  })
})
