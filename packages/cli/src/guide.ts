import { readFile } from 'node:fs/promises'

/**
 * 使い方（packages/cli/guide.md）を「## <話題> <見出し>」ごとに返す。
 * MCP の how_to と CLI の tadori how-to が同じものを読む（使い方を 2 か所に書かない）。
 */

export interface HowTo {
  readonly text: string
  /** 知らない話題を渡されたとき */
  readonly isError: boolean
}

function guideSections(markdown: string): { intro: string; sections: Array<{ topic: string; title: string; body: string }> } {
  const [intro = '', ...parts] = markdown.split(/^## /m)
  return {
    intro: intro.trim(),
    sections: parts.map(part => {
      const [head = '', ...rest] = part.split('\n')
      const [topic = '', ...title] = head.trim().split(/\s+/)
      return { topic, title: title.join(' '), body: `## ${head.trim()}\n${rest.join('\n').trim()}` }
    }),
  }
}

/** 話題が空なら、話題の一覧と最初に読むもの。話題を渡せば、その使い方だけ */
export async function howTo(guidePath: string, topic: string): Promise<HowTo> {
  const { intro, sections } = guideSections(await readFile(guidePath, 'utf8'))
  const list = sections.map(s => `- ${s.topic}：${s.title}`).join('\n')
  if (!topic) {
    return { text: `${intro}\n\n話題（topic に渡す）：\n${list}\n\n初めてなら start、エージェントは必ず agent-rules も読んでください。`, isError: false }
  }
  const found = sections.find(s => s.topic === topic)
  return found ? { text: found.body, isError: false } : { text: `「${topic}」という話題はありません。\n${list}`, isError: true }
}
