//! 裏で起こす `tadori serve` まわりの、窓に依存しない部分（テストできるように分けておく）。
//! 判定もサーバーも TypeScript の側にあり、ここは起こして URL を受け取るだけ。

use std::path::{Path, PathBuf};

/// `tadori serve` が最初に出す行（「tadori を立ち上げました：http://127.0.0.1:PORT/」）から URL を取り出す。
/// 手元（127.0.0.1）以外の URL は受け取らない（窓に外のページを開かせないため）。
pub fn ready_url(line: &str) -> Option<String> {
    let start = line.find("http://127.0.0.1:")?;
    let url: String = line[start..].chars().take_while(|c| !c.is_whitespace()).collect();
    let port = url.trim_start_matches("http://127.0.0.1:").trim_end_matches('/');
    if port.is_empty() || !port.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    Some(url)
}

/// `node <cli> serve <案件> --port 0` の引数。番号は OS に空いているものを選ばせる
pub fn serve_args(cli: &Path, project: &Path) -> Vec<String> {
    vec![
        cli.to_string_lossy().into_owned(),
        "serve".into(),
        project.to_string_lossy().into_owned(),
        "--port".into(),
        "0".into(),
    ]
}

/// tadori の CLI（packages/cli/dist/main.js）を探す場所。上から順に、在るものを使う。
/// 1. 環境変数 TADORI_CLI（手元で別の版を試すとき）
/// 2. このリポジトリの中の packages/cli/dist/main.js（開発中）
pub fn cli_candidates(env_cli: Option<String>, manifest_dir: &Path) -> Vec<PathBuf> {
    let mut list = Vec::new();
    if let Some(path) = env_cli.filter(|p| !p.trim().is_empty()) {
        list.push(PathBuf::from(path));
    }
    list.push(manifest_dir.join("..").join("..").join("cli").join("dist").join("main.js"));
    list
}

/// 案件のフォルダとして開けるか（.tadori フォルダがあるか）
pub fn is_project(dir: &Path) -> bool {
    dir.join(".tadori").is_dir()
}

/// 前回開いた案件を覚えておくファイルの中身から、まだ開ける案件だけを返す
pub fn remembered_project(saved: Option<String>) -> Option<PathBuf> {
    let path = PathBuf::from(saved?.trim());
    if path.as_os_str().is_empty() || !is_project(&path) {
        return None;
    }
    Some(path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn 立ち上げの行から手元の_url_を取り出す() {
        assert_eq!(
            ready_url("tadori を立ち上げました：http://127.0.0.1:63133/"),
            Some("http://127.0.0.1:63133/".to_string())
        );
    }

    #[test]
    fn 手元以外の_url_や番号の無い行は受け取らない() {
        assert_eq!(ready_url("案件：C:/work"), None);
        assert_eq!(ready_url("http://example.com:80/"), None);
        assert_eq!(ready_url("http://127.0.0.1:abc/"), None);
        assert_eq!(ready_url("http://127.0.0.1:/"), None);
    }

    #[test]
    fn serve_の引数は空いている番号を_os_に選ばせる() {
        let args = serve_args(Path::new("/t/main.js"), Path::new("/work/a"));
        assert_eq!(args[1..], ["serve", "/work/a", "--port", "0"]);
    }

    #[test]
    fn cli_は環境変数を先に見て_次にリポジトリの中を見る() {
        let list = cli_candidates(Some("/x/main.js".into()), Path::new("/repo/packages/desktop/src-tauri"));
        assert_eq!(list[0], PathBuf::from("/x/main.js"));
        assert!(list[1].ends_with("cli/dist/main.js"));
        assert_eq!(cli_candidates(Some("  ".into()), Path::new("/r")).len(), 1);
    }

    #[test]
    fn 前回の案件は_tadori_フォルダが残っているときだけ使う() {
        let dir = std::env::temp_dir().join(format!("tadori-desktop-test-{}", std::process::id()));
        fs::create_dir_all(dir.join(".tadori")).unwrap();
        assert_eq!(remembered_project(Some(dir.to_string_lossy().into_owned())), Some(dir.clone()));
        fs::remove_dir_all(dir.join(".tadori")).unwrap();
        assert_eq!(remembered_project(Some(dir.to_string_lossy().into_owned())), None);
        assert_eq!(remembered_project(None), None);
        fs::remove_dir_all(&dir).unwrap();
    }
}
