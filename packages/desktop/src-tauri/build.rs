fn main() {
    // 自作の命令は、capabilities で許した画面からだけ呼べるようにする（既定で誰でも呼べる形にしない）
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(&["pick_project", "recent_projects", "open_project", "open_external"])),
    )
    .expect("tauri の build に失敗しました");
}
