import { isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'

/** links の URL の所が手元のフォルダ・ファイルを指しているか */
export const isLocalRef = (ref: string): boolean => /^file:\/\/\//i.test(ref) || /^[A-Za-z]:\\/.test(ref)

/**
 * 手元のリンクを、OS のパスにする。file:/// の URL は %エンコードを戻し（日本語のパスも読める）、Windows のパスはそのまま。
 * ネットワークのパス（\\server\… や file://server/…）・相対のパスは開かない（undefined）
 */
export function localPathOf(ref: string): string | undefined {
  let path: string
  if (/^file:\/\/\//i.test(ref)) {
    try { path = fileURLToPath(ref, { windows: /^file:\/\/\/[A-Za-z]:/i.test(ref) }) } catch { return undefined }
  } else if (/^[A-Za-z]:\\/.test(ref)) {
    path = ref
  } else {
    return undefined
  }
  if (path.startsWith('\\\\') || path.startsWith('//')) return undefined
  const isWindowsAbsolute = /^[A-Za-z]:\\/.test(path)
  return isWindowsAbsolute || isAbsolute(path) ? path : undefined
}
