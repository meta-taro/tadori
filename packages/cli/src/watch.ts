import { watch, type FSWatcher } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { ServerResponse } from 'node:http'
import './i18n.js'
import { t } from '@tadori/core'

/** 保存は短い間に何度も起きる（書き込み・名前の付け替え）ので、まとめて 1 回だけ知らせる */
const DEBOUNCE_MS = 300
/** 途中の網の機器に切られないよう、ときどき空の行を送る */
const HEARTBEAT_MS = 25_000
/** 見張りの知らせが届かない置き場所（同期のフォルダ・網の向こうのドライブなど）でも拾えるよう、ときどき TSV の更新時刻を見比べる */
const POLL_MS = 2_000
/** 見比べるときに入らないフォルダ */
const SKIP_DIRS = new Set(['.git', 'node_modules'])

export interface ChangeNotifier {
  /** 画面を 1 つつなぐ（/api/events） */
  attach(res: ServerResponse): void
  /** つないでいる画面へ知らせを流す。流した画面の数を返す */
  send(event: string, data: unknown): number
  close(): void
}

/** 案件の TSV の書き換えか（.git の中は見ない。git pull で入れ替わった TSV は、TSV そのものの変化として拾える） */
const isProjectTsv = (name: string | null): boolean => {
  if (!name) return true // 名前が分からないときは、念のため知らせる
  const path = name.replace(/\\/g, '/')
  return path.endsWith('.tsv') && !path.split('/').includes('.git')
}

/** 案件の TSV の、場所・更新時刻・大きさを並べた印（変わったかを見比べるため）。読めないフォルダは飛ばす */
export async function tsvSignature(dir: string): Promise<string> {
  const parts: string[] = []
  const walk = async (folder: string): Promise<void> => {
    // 読めないフォルダ（権限・消えた途中）は見比べから外すだけで、見張りは止めない
    const entries = await readdir(folder, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      const path = join(folder, entry.name)
      if (entry.isDirectory()) { if (!SKIP_DIRS.has(entry.name)) await walk(path); continue }
      if (!entry.name.endsWith('.tsv')) continue
      const info = await stat(path).catch(() => undefined)
      if (info) parts.push(`${path}|${info.mtimeMs}|${info.size}`)
    }
  }
  await walk(dir)
  return parts.sort().join('\n')
}

/**
 * 案件のフォルダを見張り、TSV が書き換わったらつないでいる画面へ知らせる（Server-Sent Events）。
 * md-business で保存しても、git pull で入れ替わっても、tadori の画面がその場で描き直せるように。
 */
export function watchProject(dir: string): ChangeNotifier {
  const clients = new Set<ServerResponse>()
  let timer: NodeJS.Timeout | null = null

  const broadcast = () => {
    for (const res of clients) res.write(`event: changed\ndata: {}\n\n`)
  }

  let watcher: FSWatcher | null = null
  try {
    watcher = watch(dir, { recursive: true }, (_event, name) => {
      if (!isProjectTsv(name)) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(broadcast, DEBOUNCE_MS)
    })
  } catch (error: unknown) {
    // 見張れない環境でも、画面に戻ったときの読み直しは働くので止めない。理由は残す
    process.stderr.write(`${t('tadori serve: cannot watch the project folder (the screen reloads only when you return to it): {reason}', { reason: error instanceof Error ? error.message : String(error) })}\n`)
  }

  // OS の見張りの知らせが来ない置き場所のための見比べ（画面がつながっているときだけ）
  let last: string | undefined
  let polling = false
  const poll = setInterval(() => {
    if (!clients.size || polling) return
    polling = true
    void tsvSignature(dir).then(signature => {
      if (last !== undefined && signature !== last) {
        if (timer) clearTimeout(timer)
        timer = setTimeout(broadcast, DEBOUNCE_MS)
      }
      last = signature
    }).finally(() => { polling = false })
  }, POLL_MS)

  const heartbeat = setInterval(() => { for (const res of clients) res.write(': keep-alive\n\n') }, HEARTBEAT_MS)

  return {
    attach(res) {
      res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive' })
      res.write(': つながりました\n\n')
      clients.add(res)
      res.on('close', () => clients.delete(res))
    },
    send(event, data) {
      const line = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
      for (const res of clients) res.write(line)
      return clients.size
    },
    close() {
      if (timer) clearTimeout(timer)
      clearInterval(heartbeat)
      clearInterval(poll)
      watcher?.close()
      for (const res of clients) res.end()
      clients.clear()
    },
  }
}
