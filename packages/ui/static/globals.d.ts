// 画面の JavaScript を TypeScript で型の検査をするための宣言（実行には使わない。tadori serve は .d.ts を配らなくてよい）

interface TadoriTheme {
  /** いま選んでいる配色（light / dark / system） */
  choice(): string
  set(value: string): void
}

interface Window {
  /** デスクトップアプリ（Tauri）の窓で開いたときだけある */
  __TAURI__?: {
    core: { invoke<T = unknown>(command: string, args?: Record<string, unknown>): Promise<T> }
    window: { getCurrentWindow(): { startDragging(): Promise<void>; minimize(): Promise<void>; toggleMaximize(): Promise<void>; close(): Promise<void>; isMaximized(): Promise<boolean>; onResized(handler: () => void): Promise<() => void> } }
  }
  tadoriTheme?: TadoriTheme
}
