import { access, readFile } from 'node:fs/promises'
import { addJapanese, currentLang, t } from '@tadori/core'

/**
 * 使い方（packages/cli/guide.md。日本語は guide.ja.md）を「## <話題> <見出し>」ごとに返す。
 * MCP の how_to と CLI の tadori how-to が同じものを読む（使い方を 2 か所に書かない）。
 * 言語は core の currentLang() に従う（ja なら guide.ja.md、それ以外は guide.md）。
 */

addJapanese({
  'Topics (pass as topic):': '話題（topic に渡す）：',
  'If this is your first time, read start. Agents must also read agent-rules.': '初めてなら start、エージェントは必ず agent-rules も読んでください。',
  'There is no topic "{topic}".': '「{topic}」という話題はありません。',
  '- {topic}: {title}': '- {topic}：{title}',
})

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

/** 日本語のときは guide.md の隣の guide.ja.md。無ければ guide.md（英語）を読む */
async function guideForLang(guidePath: string): Promise<string> {
  if (currentLang() === 'ja') {
    const jaPath = guidePath.replace(/\.md$/i, '.ja.md')
    const hasJapanese = await access(jaPath).then(() => true, () => false)
    if (jaPath !== guidePath && hasJapanese) return readFile(jaPath, 'utf8')
  }
  return readFile(guidePath, 'utf8')
}

/** 話題が空なら、話題の一覧と最初に読むもの。話題を渡せば、その使い方だけ */
export async function howTo(guidePath: string, topic: string): Promise<HowTo> {
  const { intro, sections } = guideSections(await guideForLang(guidePath))
  const list = sections.map(s => t('- {topic}: {title}', { topic: s.topic, title: s.title })).join('\n')
  if (!topic) {
    return {
      text: `${intro}\n\n${t('Topics (pass as topic):')}\n${list}\n\n${t('If this is your first time, read start. Agents must also read agent-rules.')}`,
      isError: false,
    }
  }
  const found = sections.find(s => s.topic === topic)
  return found ? { text: found.body, isError: false } : { text: `${t('There is no topic "{topic}".', { topic })}\n${list}`, isError: true }
}
