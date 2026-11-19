import { isBornFrom, type Item, type Project, type Rule } from '../domain/model.js'

/** 失敗の行と、そこから生まれたルール（ルールの source 列のどれかがその行の ID） */
export interface FailureLessons {
  readonly item: Item
  readonly rules: readonly Rule[]
}

/** 既定で失敗として見る行の種類（lesson_add が足す行の種類） */
export const FAILURE_KINDS: readonly string[] = ['FL']

/**
 * 失敗の行ごとに、そこから生まれたルールを並べる。台帳の順のまま返す。
 * ルールが 1 つも無い行もそのまま返す（ルールにならないまま残った失敗を見つけるため）。
 * 「足りている」とは判定しない。並べるだけ。
 */
export function lessonsByFailure(project: Project, kinds: readonly string[] = FAILURE_KINDS): FailureLessons[] {
  const wanted = new Set(kinds)
  return project.items
    .filter(item => wanted.has(item.kind))
    .map(item => ({ item, rules: project.rules.filter(r => isBornFrom(r, item.id)) }))
}
