// リリース版で、Windows の黒いコンソール窓を出さない
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tadori_desktop_lib::run()
}
