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

/// 窓で使う決まった番号。画面の好み（配色など）はブラウザが「番号ごと」に覚えるので、毎回同じ番号で開く
pub const PREFERRED_PORT: u16 = 4873;

/// 決まった番号が空いていればそれを、ふさがっていれば 0（OS に空いている番号を選ばせる）を返す
pub fn choose_port(preferred: u16) -> u16 {
    match std::net::TcpListener::bind(("127.0.0.1", preferred)) {
        Ok(_listener) => preferred, // ここで手放す。すぐ tadori serve がつなぐ
        Err(_) => 0,
    }
}

/// `node <cli> serve <案件> --port <番号>` の引数
pub fn serve_args(cli: &Path, project: &Path, port: u16) -> Vec<String> {
    vec![
        cli.to_string_lossy().into_owned(),
        "serve".into(),
        project.to_string_lossy().into_owned(),
        "--port".into(),
        port.to_string(),
    ]
}

/// `node <cli> init <フォルダ> --name <名前>` の引数（最小の設定と台帳を置く。あるファイルは書き換えない）
pub fn init_args(cli: &Path, dir: &Path, name: &str) -> Vec<String> {
    vec![
        cli.to_string_lossy().into_owned(),
        "init".into(),
        dir.to_string_lossy().into_owned(),
        "--name".into(),
        name.to_string(),
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

/// 最近の案件として覚えておく数
pub const RECENT_LIMIT: usize = 8;

/// 覚えておいたファイルの中身（1 行 1 案件・新しい順）から、まだ開ける案件だけを返す
pub fn parse_recent(saved: &str) -> Vec<PathBuf> {
    // 先頭の BOM は飛ばす（メモ帳や PowerShell で書くと付くことがある）
    saved
        .trim_start_matches('﻿')
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .map(PathBuf::from)
        .filter(|p| is_project(p))
        .collect()
}

/// 開いた案件を先頭にし、同じものは 1 つにまとめ、多すぎる分は捨てる（元の一覧は変えない）
pub fn with_recent(list: &[PathBuf], opened: &Path, limit: usize) -> Vec<PathBuf> {
    std::iter::once(opened.to_path_buf())
        .chain(list.iter().filter(|p| p.as_path() != opened).cloned())
        .take(limit)
        .collect()
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
    fn serve_の引数に番号を渡す() {
        let args = serve_args(Path::new("/t/main.js"), Path::new("/work/a"), 4873);
        assert_eq!(args[1..], ["serve", "/work/a", "--port", "4873"]);
    }

    #[test]
    fn 決まった番号がふさがっていれば_0_にする() {
        let busy = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = busy.local_addr().unwrap().port();
        assert_eq!(choose_port(port), 0);
        drop(busy);
        assert_eq!(choose_port(port), port);
    }

    #[test]
    fn init_の引数はフォルダと案件の名前() {
        let args = init_args(Path::new("/t/main.js"), Path::new("/work/新しい案件"), "新しい案件");
        assert_eq!(args[1..], ["init", "/work/新しい案件", "--name", "新しい案件"]);
    }

    #[test]
    fn cli_は環境変数を先に見て_次にリポジトリの中を見る() {
        let list = cli_candidates(Some("/x/main.js".into()), Path::new("/repo/packages/desktop/src-tauri"));
        assert_eq!(list[0], PathBuf::from("/x/main.js"));
        assert!(list[1].ends_with("cli/dist/main.js"));
        assert_eq!(cli_candidates(Some("  ".into()), Path::new("/r")).len(), 1);
    }

    #[test]
    fn 最近の案件は開いたものを先頭にし_重ねず_数を絞る() {
        let a = PathBuf::from("/a");
        let b = PathBuf::from("/b");
        let c = PathBuf::from("/c");
        assert_eq!(with_recent(&[a.clone(), b.clone()], &b, 8), vec![b.clone(), a.clone()]);
        assert_eq!(with_recent(&[a.clone(), b.clone()], &c, 2), vec![c, a]);
    }

    #[test]
    fn 最近の案件の一覧からは_開けなくなった案件を外す() {
        let dir = std::env::temp_dir().join(format!("tadori-recent-test-{}", std::process::id()));
        fs::create_dir_all(dir.join(".tadori")).unwrap();
        let text = format!("{}

/nowhere/x
", dir.display());
        assert_eq!(parse_recent(&text), vec![dir.clone()]);
        assert_eq!(parse_recent(&format!("﻿{}", dir.display())), vec![dir.clone()]);
        fs::remove_dir_all(&dir).unwrap();
    }
}
