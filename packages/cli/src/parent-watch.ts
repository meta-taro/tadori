/**
 * 親のプロセス（デスクトップアプリ）を見張り、居なくなったら知らせる。
 * デスクトップアプリが落ちても裏の tadori serve が残ると、番号をふさぎ、次に開いたときに別の番号で立ち上がる。
 * OS ごとの仕組み（Windows の Job Object など）に頼らず、どの OS でも同じに動くよう、親の番号を数秒ごとに確かめる
 */

/** 親を確かめる間隔 */
const DEFAULT_INTERVAL_MS = 2000

/** 環境変数 TADORI_PARENT_PID の値を、見張る親の番号にする。正の整数でなければ見張らない */
export function parentPidFromEnv(value: string | undefined): number | undefined {
  if (!value || !/^\d+$/.test(value.trim())) return undefined
  const pid = Number(value.trim())
  return Number.isSafeInteger(pid) && pid > 0 ? pid : undefined
}

/** その番号のプロセスが動いているか（signal 0 は送らずに確かめるだけ） */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error: unknown) {
    // EPERM は「居るが触れない」＝生きている。それ以外（ESRCH など）は居ない
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** 親が居なくなったら onGone を 1 回だけ呼ぶ。見張りは自分の終了を引き止めない（unref） */
export function watchParent(pid: number, onGone: () => void, options: { intervalMs?: number; isAlive?: (pid: number) => boolean } = {}): () => void {
  const isAlive = options.isAlive ?? isProcessAlive
  const timer = setInterval(() => {
    if (isAlive(pid)) return
    clearInterval(timer)
    onGone()
  }, options.intervalMs ?? DEFAULT_INTERVAL_MS)
  timer.unref?.()
  return () => clearInterval(timer)
}
