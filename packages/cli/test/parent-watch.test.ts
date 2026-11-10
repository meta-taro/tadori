import { describe, expect, test, vi } from 'vitest'
import { isProcessAlive, parentPidFromEnv, watchParent } from '../src/parent-watch.js'

describe('parentPidFromEnv（デスクトップアプリが渡す親のプロセス番号）', () => {
  test('正の整数だけを受ける。無い・おかしい値は見張らない', () => {
    expect(parentPidFromEnv('1234')).toBe(1234)
    expect(parentPidFromEnv(undefined)).toBeUndefined()
    expect(parentPidFromEnv('')).toBeUndefined()
    expect(parentPidFromEnv('abc')).toBeUndefined()
    expect(parentPidFromEnv('-5')).toBeUndefined()
  })
})

describe('isProcessAlive', () => {
  test('いま動いている自分は生きている。使われていない番号は生きていない', () => {
    expect(isProcessAlive(process.pid)).toBe(true)
    expect(isProcessAlive(2 ** 31 - 2)).toBe(false)
  })
})

describe('watchParent（親が落ちたら止まる）', () => {
  test('親が生きている間は何もしない。居なくなったら 1 回だけ知らせて見張りをやめる', () => {
    vi.useFakeTimers()
    let alive = true
    const onGone = vi.fn()
    watchParent(42, onGone, { intervalMs: 1000, isAlive: () => alive })
    vi.advanceTimersByTime(3000)
    expect(onGone).not.toHaveBeenCalled()
    alive = false
    vi.advanceTimersByTime(1000)
    vi.advanceTimersByTime(5000)
    expect(onGone).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })
})
