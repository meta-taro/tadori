import { describe, expect, test } from 'vitest'
import type { Item, Project, Rule } from '../src/domain/model.js'
import { lessonsByFailure } from '../src/usecase/lessons.js'
import { sampleProject } from './fixtures.js'

const failure = (id: string, kind = 'FL'): Item => ({ id, kind, title: `${id} の失敗`, source: '', refs: [], fields: {} })
const noteFrom = (id: string, source: string): Rule => ({ id, phase: '', kind: 'note', from: '', to: '', field: '', label: `${id} の約束`, source })

const project: Project = {
  ...sampleProject,
  items: [...sampleProject.items, failure('FL-1'), failure('FL-2'), failure('FL-3')],
  rules: [...sampleProject.rules, noteFrom('N1', 'FL-1'), noteFrom('N2', 'FL-1'), noteFrom('N3', 'FL-3')],
}

describe('lessonsByFailure', () => {
  test('失敗の行（既定は FL）ごとに、source でつながるルールを並べる', () => {
    const result = lessonsByFailure(project)
    expect(result.map(r => [r.item.id, r.rules.map(x => x.id)])).toEqual([
      ['FL-1', ['N1', 'N2']],
      ['FL-2', []],
      ['FL-3', ['N3']],
    ])
  })

  test('種類を渡せば、その種類の行を見る（ほかの種類は入れない）', () => {
    const result = lessonsByFailure(project, ['F'])
    expect(result.map(r => r.item.id)).toEqual(['F-1'])
    expect(result[0]?.rules).toEqual([])
  })

  test('失敗の行が無ければ空', () => {
    expect(lessonsByFailure(sampleProject)).toEqual([])
  })
})
