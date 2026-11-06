// Windows で、黒いコンソール窓を出さない（開発版でも出さない。tadori の言葉は窓とダイアログで伝える）
#![windows_subsystem = "windows"]

fn main() {
    tadori_desktop_lib::run()
}
