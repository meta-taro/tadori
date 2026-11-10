//! tadori のデスクトップアプリ。
//! 窓を出し、裏で `tadori serve` を起こして、その画面を窓に映す。判定は TypeScript の核のまま（CLI・CI と食い違わないように）。
//!
//! 画面（127.0.0.1 のページ）から呼べるのは、自作の上の帯のための窓の操作と、ここにある 4 つの命令だけ
//! （capabilities/desktop-shell.json）。ファイルの読み書きなどは呼ばせない。

mod lang;
mod sidecar;

use lang::tr;

use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};

use tauri::{AppHandle, Manager, RunEvent, Url};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

/// 裏で起こした `tadori serve`。案件を切り替えるときと、窓を閉じたときに止める
struct Sidecar(Mutex<Option<Child>>);

/// 最近開いた案件（1 行 1 案件・新しい順）
const RECENT_FILE: &str = "recent-projects.txt";

/// アプリの中に入れた tadori の本体（resources）を探すために、起動したときに覚えておく
static APP: std::sync::OnceLock<AppHandle> = std::sync::OnceLock::new();

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(Sidecar(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![pick_project, recent_projects, open_project, open_external])
        .setup(|app| {
            let handle = app.handle().clone();
            let _ = APP.set(handle.clone());
            // フォルダ選びと起動を待つ間も窓が固まらないよう、別のスレッドで進める
            std::thread::spawn(move || open_first_project(handle));
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("could not create the tadori window");

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
        return Err(tr("That folder is not in your recent projects. Choose it with \"Open project…\".", "最近の案件にない場所は開けません。「案件を開く…」から選んでください").into());
    }
    switch_project(&handle, &wanted)
}

/// 正本（.tadori/sources.tsv に書いた文書・課題の URL）を OS の既定のブラウザで開く。
/// 窓の中で外のページへ移ると tadori に戻れなくなるため。http と https だけを受ける（ファイルや命令は開かない）
#[tauri::command]
fn open_external(handle: AppHandle, url: String) -> Result<(), String> {
    let parsed = Url::parse(&url).map_err(|_| format!("{}{url}", tr("Not a valid URL: ", "URL として読めません：")))?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(tr("Only http and https links can be opened", "正本のリンクは http か https だけを開きます").into());
    }
    use tauri_plugin_opener::OpenerExt;
    handle.opener().open_url(parsed.as_str(), None::<&str>).map_err(|e| format!("{}{e}", tr("Could not open the browser: ", "ブラウザで開けませんでした：")))
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

/// 案件のフォルダを選んでもらう。.tadori が無ければ、そこで始めるかを聞く。やめたら None
fn ask_for_project(handle: &AppHandle) -> Option<PathBuf> {
    loop {
        let picked = handle
            .dialog()
            .file()
            .set_title(tr("Choose a project folder for tadori (a new folder is fine)", "tadori で開く案件のフォルダを選ぶ（新しく始めるフォルダでもよい）"))
            .blocking_pick_folder()?;
        let path = picked.into_path().ok()?;
        if sidecar::is_project(&path) {
            return Some(path);
        }
        if !confirm_start(handle, &path) {
            continue;
        }
        match init_project(&path) {
            Ok(()) => return Some(path),
            Err(message) => show_error(handle, &message),
        }
    }
}

/// .tadori の無いフォルダで、tadori を始めてよいかを聞く
fn confirm_start(handle: &AppHandle, dir: &Path) -> bool {
    handle
        .dialog()
        .message(format!(
            "{}{}",
            dir.display(),
            tr(
                " has no tadori settings yet.\n\nStart here?\ntadori adds .tadori (phases, statuses, rules) and ledger (ledger, WBS, approvals). Existing files are never overwritten. Nothing is committed.",
                " には、まだ tadori の設定がありません。\n\nここで始めますか？\n.tadori（工程・ステータス・ルール）と ledger（台帳・WBS・承認の記録）を置きます。すでにあるファイルは書き換えません。commit はしません。",
            )
        ))
        .title(tr("Start tadori", "tadori を始める"))
        .kind(MessageDialogKind::Info)
        .buttons(MessageDialogButtons::OkCancelCustom(tr("Start", "始める").into(), tr("Cancel", "やめる").into()))
        .blocking_show()
}

/// `tadori init` で、最小の設定と台帳を置く。案件の名前はフォルダの名前（あとで .tadori/project.tsv で変えられる）
fn init_project(dir: &Path) -> Result<(), String> {
    let cli = find_cli()?;
    let mut command = Command::new("node");
    command.args(sidecar::init_args(&cli, dir, &folder_name(dir)));
    hide_console(&mut command);
    let output = command.output().map_err(|e| format!("{}{e}", tr("Could not start tadori: ", "tadori を始められませんでした：")))?;
    if output.status.success() {
        return Ok(());
    }
    Err(format!("{}\n{}", tr("Could not start tadori.", "tadori を始められませんでした。"), String::from_utf8_lossy(&output.stderr).trim()))
}

/// `tadori serve` を起こし、立ち上がったら窓に映して戻る（出力は別のスレッドで読み続ける）
fn start_and_show(handle: &AppHandle, project: &Path) -> Result<(), String> {
    let cli = find_cli()?;
    let mut command = Command::new("node");
    command
        .args(sidecar::serve_args(&cli, project, sidecar::choose_port(sidecar::PREFERRED_PORT)))
        // アプリが落ちても裏の serve が残らないよう、serve にアプリの番号を渡して見張らせる（どの OS でも同じ仕組み）
        .env("TADORI_PARENT_PID", std::process::id().to_string())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    // 画面のヘルプ「バージョンと更新」に、アプリの版を出すため。debug で組んだ版は渡さない（手元で組んだ版として、配布の版と比べない）
    match sidecar::app_version_for_screen(&handle.package_info().version.to_string(), cfg!(debug_assertions)) {
        Some(version) => command.env("TADORI_APP_VERSION", version),
        None => command.env_remove("TADORI_APP_VERSION"),
    };
    hide_console(&mut command);
    let mut child = command.spawn().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            tr("Node.js was not found. Install Node.js 22 or later, then open tadori again.", "Node.js が見つかりません。Node.js 22 以上を入れてから、もう一度開いてください。").to_string()
        } else {
            format!("{}{e}", tr("Could not start tadori: ", "tadori を起こせませんでした："))
        }
    })?;
    let stdout = child.stdout.take().ok_or(tr("Could not read tadori's output", "tadori の出力を読めませんでした"))?;
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
    Err(format!("{}\n{detail}", tr("tadori did not start.", "tadori が立ち上がりませんでした。")))
}

fn show_in_window(handle: &AppHandle, url: &str, project: &Path) -> Result<(), String> {
    let window = handle.get_webview_window("main").ok_or(tr("The tadori window was not found", "tadori の窓が見つかりません"))?;
    let url = Url::parse(url).map_err(|e| format!("{}{e}", tr("Could not read the URL: ", "URL を読めませんでした：")))?;
    let _ = window.set_title(&format!("tadori — {}", folder_name(project)));
    window.navigate(url).map_err(|e| format!("{}{e}", tr("Could not open the screen: ", "画面を開けませんでした：")))
}

fn find_cli() -> Result<PathBuf, String> {
    let resources = APP.get().and_then(|h| h.path().resource_dir().ok());
    let candidates = sidecar::cli_candidates(std::env::var("TADORI_CLI").ok(), resources.as_deref(), Path::new(env!("CARGO_MANIFEST_DIR")), cfg!(debug_assertions));
    candidates.iter().find(|p| p.is_file()).cloned().ok_or_else(|| {
        let tried: Vec<String> = candidates.iter().map(|p| p.display().to_string()).collect();
        format!("{}\n{}", tr("tadori's main program (main.js) was not found. Run `pnpm build`, then open it again.\nLooked in:", "tadori の本体（main.js）が見つかりません。`pnpm build` をしてから開いてください。\n探した所："), tried.join("\n"))
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
