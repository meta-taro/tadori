//! tadori のデスクトップアプリ。
//! 窓を出し、裏で `tadori serve` を起こして、その画面を窓に映す。判定は TypeScript の核のまま（CLI・CI と食い違わないように）。
//!
//! 画面（127.0.0.1 のページ）から呼べるのは、自作の上の帯のための窓の操作と、ここにある 3 つの命令だけ
//! （capabilities/desktop-shell.json）。ファイルの読み書きなどは呼ばせない。

mod sidecar;

use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};

use tauri::{AppHandle, Manager, RunEvent, Url};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

/// 裏で起こした `tadori serve`。案件を切り替えるときと、窓を閉じたときに止める
struct Sidecar(Mutex<Option<Child>>);

/// 最近開いた案件（1 行 1 案件・新しい順）
const RECENT_FILE: &str = "recent-projects.txt";

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(Sidecar(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![pick_project, recent_projects, open_project])
        .setup(|app| {
            let handle = app.handle().clone();
            // フォルダ選びと起動を待つ間も窓が固まらないよう、別のスレッドで進める
            std::thread::spawn(move || open_first_project(handle));
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("tadori の窓を作れませんでした");

    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            stop_sidecar(handle);
        }
    });
}

// ---- 画面（上の帯のメニュー）から呼ぶ命令 ----

/// ファイル › 案件を開く…：フォルダを選んで切り替える。やめたら何もしない
#[tauri::command]
async fn pick_project(handle: AppHandle) -> Result<(), String> {
    match ask_for_project(&handle) {
        Some(project) => switch_project(&handle, &project),
        None => Ok(()),
    }
}

/// ファイル › 最近の案件：[場所, 名前] の一覧（新しい順・開けなくなったものは除く）
#[tauri::command]
fn recent_projects(handle: AppHandle) -> Vec<[String; 2]> {
    read_recent(&handle)
        .iter()
        .map(|p| [p.to_string_lossy().into_owned(), folder_name(p)])
        .collect()
}

/// 最近の案件から 1 つを開く。画面から好きな場所を開かせないよう、最近の案件にあるものだけを受ける
#[tauri::command]
async fn open_project(handle: AppHandle, path: String) -> Result<(), String> {
    let wanted = PathBuf::from(path);
    if !read_recent(&handle).contains(&wanted) {
        return Err("最近の案件にない場所は開けません。「案件を開く…」から選んでください".into());
    }
    switch_project(&handle, &wanted)
}

// ---- 起動と切り替え ----

/// 起動したときの案件を開く。開けなければ理由を見せて閉じる
fn open_first_project(handle: AppHandle) {
    let Some(project) = first_project(&handle) else {
        handle.exit(0);
        return;
    };
    match start_and_show(&handle, &project) {
        Ok(()) => remember_project(&handle, &project),
        Err(message) => {
            show_error(&handle, &message);
            handle.exit(1);
        }
    }
}

/// 起動の引数 → 最近の案件の先頭 → フォルダ選び、の順で決める
fn first_project(handle: &AppHandle) -> Option<PathBuf> {
    if let Some(arg) = std::env::args().nth(1).map(PathBuf::from).filter(|p| sidecar::is_project(p)) {
        return Some(arg);
    }
    read_recent(handle).into_iter().next().or_else(|| ask_for_project(handle))
}

/// いまの案件を止めて、別の案件を開く。開けなければ理由を見せ、元の案件に戻す
fn switch_project(handle: &AppHandle, project: &Path) -> Result<(), String> {
    let previous = read_recent(handle).into_iter().next();
    stop_sidecar(handle);
    match start_and_show(handle, project) {
        Ok(()) => {
            remember_project(handle, project);
            Ok(())
        }
        Err(message) => {
            show_error(handle, &message);
            if let Some(back) = previous {
                start_and_show(handle, &back)?;
            }
            Err(message)
        }
    }
}

/// .tadori のあるフォルダを選んでもらう。やめたら None
fn ask_for_project(handle: &AppHandle) -> Option<PathBuf> {
    loop {
        let picked = handle.dialog().file().set_title("tadori で開く案件のフォルダを選ぶ").blocking_pick_folder()?;
        let path = picked.into_path().ok()?;
        if sidecar::is_project(&path) {
            return Some(path);
        }
        show_error(
            handle,
            &format!(
                "{} には .tadori フォルダがありません。\n新しく始めるときは、いまは `tadori init <フォルダ>` で置いてから選んでください。",
                path.display()
            ),
        );
    }
}

/// `tadori serve` を起こし、立ち上がったら窓に映して戻る（出力は別のスレッドで読み続ける）
fn start_and_show(handle: &AppHandle, project: &Path) -> Result<(), String> {
    let cli = find_cli()?;
    let mut command = Command::new("node");
    command
        .args(sidecar::serve_args(&cli, project, sidecar::choose_port(sidecar::PREFERRED_PORT)))
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    hide_console(&mut command);
    let mut child = command.spawn().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            "Node.js が見つかりません。Node.js 22 以上を入れてから、もう一度開いてください。".to_string()
        } else {
            format!("tadori を起こせませんでした：{e}")
        }
    })?;
    let stdout = child.stdout.take().ok_or("tadori の出力を読めませんでした")?;
    let errors = collect_stderr(&mut child);
    *handle.state::<Sidecar>().0.lock().unwrap() = Some(child);

    let mut lines = BufReader::new(stdout).lines();
    for line in lines.by_ref().map_while(Result::ok) {
        if let Some(url) = sidecar::ready_url(&line) {
            // 残りの出力も読み続ける（読まないと、出力が詰まって tadori が止まる）
            std::thread::spawn(move || for _ in lines {});
            return show_in_window(handle, &url, project);
        }
    }
    // 立ち上がる前に終わった：案件を読めなかったなど。tadori の言葉をそのまま見せる
    std::thread::sleep(std::time::Duration::from_millis(200));
    let detail = errors.lock().map(|e| e.trim().to_string()).unwrap_or_default();
    Err(format!("tadori が立ち上がりませんでした。\n{detail}"))
}

fn show_in_window(handle: &AppHandle, url: &str, project: &Path) -> Result<(), String> {
    let window = handle.get_webview_window("main").ok_or("tadori の窓が見つかりません")?;
    let url = Url::parse(url).map_err(|e| format!("URL を読めませんでした：{e}"))?;
    let _ = window.set_title(&format!("tadori — {}", folder_name(project)));
    window.navigate(url).map_err(|e| format!("画面を開けませんでした：{e}"))
}

fn find_cli() -> Result<PathBuf, String> {
    let candidates = sidecar::cli_candidates(std::env::var("TADORI_CLI").ok(), Path::new(env!("CARGO_MANIFEST_DIR")));
    candidates.iter().find(|p| p.is_file()).cloned().ok_or_else(|| {
        let tried: Vec<String> = candidates.iter().map(|p| p.display().to_string()).collect();
        format!("tadori の本体（main.js）が見つかりません。`pnpm build` をしてから開いてください。\n探した所：\n{}", tried.join("\n"))
    })
}

/// 立ち上がる前に終わったときの理由を見せるため、エラーの出力をためておく
fn collect_stderr(child: &mut Child) -> Arc<Mutex<String>> {
    let buffer = Arc::new(Mutex::new(String::new()));
    if let Some(mut stderr) = child.stderr.take() {
        let target = Arc::clone(&buffer);
        std::thread::spawn(move || {
            let mut text = String::new();
            let _ = stderr.read_to_string(&mut text);
            if let Ok(mut b) = target.lock() {
                b.push_str(&text);
            }
        });
    }
    buffer
}

fn stop_sidecar(handle: &AppHandle) {
    if let Some(mut child) = handle.state::<Sidecar>().0.lock().unwrap().take() {
        // 止められなくても（すでに終わっているなど）、先へ進んでよい
        let _ = child.kill();
        let _ = child.wait();
    }
}

// ---- 最近の案件 ----

fn recent_file(handle: &AppHandle) -> Option<PathBuf> {
    handle.path().app_config_dir().ok().map(|d| d.join(RECENT_FILE))
}

fn read_recent(handle: &AppHandle) -> Vec<PathBuf> {
    let text = recent_file(handle).and_then(|f| std::fs::read_to_string(f).ok()).unwrap_or_default();
    sidecar::parse_recent(&text)
}

fn remember_project(handle: &AppHandle, project: &Path) {
    let Some(file) = recent_file(handle) else { return };
    let list = sidecar::with_recent(&read_recent(handle), project, sidecar::RECENT_LIMIT);
    let text: Vec<String> = list.iter().map(|p| p.to_string_lossy().into_owned()).collect();
    // 覚えられなくても開くのは続ける（次回フォルダを選び直すだけ）
    if let Some(dir) = file.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let _ = std::fs::write(file, text.join("\n"));
}

fn folder_name(path: &Path) -> String {
    path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| path.display().to_string())
}

fn show_error(handle: &AppHandle, message: &str) {
    handle.dialog().message(message).title("tadori").kind(MessageDialogKind::Error).blocking_show();
}

#[cfg(windows)]
fn hide_console(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    // 裏の node に黒いコンソール窓を出させない（CREATE_NO_WINDOW）
    command.creation_flags(0x0800_0000);
}

#[cfg(not(windows))]
fn hide_console(_command: &mut Command) {}
