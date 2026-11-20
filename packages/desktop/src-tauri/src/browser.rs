//! 正本のリンクを、いつものブラウザの小さな窓（アドレスバーの無い窓）でさっと見る。
//! tadori の中に別のブラウザを持たないのは、いつものブラウザのログインを使えず、アカウントの要るページが全部はじかれるため。
//! 小さな窓で開けるのは Chromium 系（Chrome・Edge・Brave・Vivaldi）の `--app=` だけ。既定のブラウザがそれ以外なら、ふつうに開く

use std::path::{Path, PathBuf};
use std::process::Command;

/// 小さな窓の大きさ（さっと見るだけなので、画面を覆わない大きさ）
const WINDOW_SIZE: &str = "--window-size=960,720";

/// Windows の既定のブラウザの実行ファイルのうち、`--app=` で小さな窓を開けるもの
const CHROMIUM_EXES: [&str; 4] = ["chrome.exe", "msedge.exe", "brave.exe", "vivaldi.exe"];
/// mac の既定のブラウザの bundle id のうち、`--app=` で小さな窓を開けるもの（小文字で比べる）
#[cfg_attr(not(target_os = "macos"), allow(dead_code))] // mac でだけ使う（試験はどの OS でも走らせる）
const CHROMIUM_BUNDLES: [&str; 4] = ["com.google.chrome", "com.microsoft.edgemac", "com.brave.browser", "com.vivaldi.vivaldi"];

/// `reg query` の出力から REG_SZ の値を取り出す（「(既定)」などの見出しは OS の言語で変わるので、型の名前で探す）
pub fn reg_sz(output: &str) -> Option<String> {
    output.lines().find_map(|line| line.split_once("REG_SZ").map(|(_, value)| value.trim().to_string())).filter(|v| !v.is_empty())
}

/// 開く命令（例 `"C:\…\chrome.exe" --single-argument %1`）の先頭の実行ファイルが Chromium 系なら、その場所
pub fn chromium_exe(command: &str) -> Option<PathBuf> {
    let command = command.trim();
    let exe = match command.strip_prefix('"') {
        Some(rest) => rest.split('"').next()?,
        None => command.split_whitespace().next()?,
    };
    let name = Path::new(exe).file_name()?.to_string_lossy().to_lowercase();
    CHROMIUM_EXES.contains(&name.as_str()).then(|| PathBuf::from(exe))
}

/// `defaults read …launchservices.secure LSHandlers` の出力から、https を開くアプリの bundle id（小文字）
#[cfg_attr(not(target_os = "macos"), allow(dead_code))] // mac でだけ使う（試験はどの OS でも走らせる）
pub fn https_bundle(output: &str) -> Option<String> {
    // 1 つの割り当ては「}」か「},」だけの行で閉じる（中の { … }; は 1 行に収まるので、行で分ければ取り違えない）
    let mut entry: Vec<&str> = Vec::new();
    for line in output.lines() {
        let trimmed = line.trim();
        if trimmed == "}," || trimmed == "}" {
            if entry.iter().any(|l| l.trim() == "LSHandlerURLScheme = https;") {
                return entry.iter().find_map(|l| {
                    let value = l.trim().strip_prefix("LSHandlerRoleAll = ")?.trim_end_matches(';').trim_matches('"');
                    (!value.is_empty() && value != "-").then(|| value.to_lowercase())
                });
            }
            entry.clear();
        } else {
            entry.push(line);
        }
    }
    None
}

/// `--app=` の小さな窓に渡す引数（URL は http・https を確かめ済みのものだけを受ける。シェルを通さないので、そのまま渡す）
pub fn app_args(url: &str) -> [String; 2] {
    [format!("--app={url}"), WINDOW_SIZE.to_string()]
}

fn output_of(command: &mut Command) -> Option<String> {
    let out = command.output().ok()?;
    out.status.success().then(|| String::from_utf8_lossy(&out.stdout).into_owned())
}

/// いつものブラウザの小さな窓で開く。開けた（Chromium 系だった）なら true。既定のブラウザが分からないか、小さな窓を持たないなら false
#[cfg(windows)]
pub fn open_small(url: &str) -> bool {
    let quiet = |mut command: Command| {
        crate::hide_console(&mut command);
        command
    };
    let mut prog = quiet(Command::new("reg"));
    prog.args(["query", r"HKCU\Software\Microsoft\Windows\Shell\Associations\UrlAssociations\https\UserChoice", "/v", "ProgId"]);
    let Some(prog_id) = output_of(&mut prog).and_then(|o| reg_sz(&o)) else { return false };
    let mut open = quiet(Command::new("reg"));
    open.args(["query", &format!(r"HKCR\{prog_id}\shell\open\command"), "/ve"]);
    let Some(exe) = output_of(&mut open).and_then(|o| reg_sz(&o)).and_then(|c| chromium_exe(&c)) else { return false };
    Command::new(exe).args(app_args(url)).spawn().is_ok()
}

#[cfg(target_os = "macos")]
pub fn open_small(url: &str) -> bool {
    let mut read = Command::new("defaults");
    read.args(["read", "com.apple.LaunchServices/com.apple.launchservices.secure", "LSHandlers"]);
    let Some(bundle) = output_of(&mut read).and_then(|o| https_bundle(&o)) else { return false };
    if !CHROMIUM_BUNDLES.contains(&bundle.as_str()) {
        return false;
    }
    let [app, size] = app_args(url);
    Command::new("open").args(["-n", "-b", &bundle, "--args", &app, &size]).spawn().is_ok()
}

#[cfg(not(any(windows, target_os = "macos")))]
pub fn open_small(_url: &str) -> bool {
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reg_sz_reads_the_value_whatever_the_heading_language() {
        let en = "\r\nHKEY_CLASSES_ROOT\\ChromeHTML\\shell\\open\\command\r\n    (Default)    REG_SZ    \"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe\" --single-argument %1\r\n";
        let ja = "    (既定)    REG_SZ    ChromeHTML\r\n";
        assert_eq!(reg_sz(en).as_deref(), Some("\"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe\" --single-argument %1"));
        assert_eq!(reg_sz(ja).as_deref(), Some("ChromeHTML"));
        assert_eq!(reg_sz("ERROR"), None);
    }

    #[test]
    fn chromium_exe_accepts_only_chromium_browsers() {
        assert_eq!(chromium_exe("\"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe\" --single-argument %1"), Some(PathBuf::from("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe")));
        assert!(chromium_exe("\"C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\MSEDGE.EXE\" --single-argument %1").is_some());
        assert_eq!(chromium_exe("\"C:\\Program Files\\Mozilla Firefox\\firefox.exe\" -osint -url \"%1\""), None);
        assert_eq!(chromium_exe(""), None);
    }

    #[test]
    fn https_bundle_finds_the_https_handler() {
        let out = "(\n        {\n        LSHandlerContentType = \"public.html\";\n        LSHandlerRoleAll = \"com.apple.safari\";\n    },\n        {\n        LSHandlerPreferredVersions = { LSHandlerRoleAll = \"-\"; };\n        LSHandlerRoleAll = \"com.google.chrome\";\n        LSHandlerURLScheme = https;\n    }\n)";
        assert_eq!(https_bundle(out).as_deref(), Some("com.google.chrome"));
        // 並びが逆でも、同じ割り当ての中から読む
        let reversed = "(\n        {\n        LSHandlerRoleAll = \"com.microsoft.edgemac\";\n        LSHandlerURLScheme = https;\n        LSHandlerPreferredVersions = { LSHandlerRoleAll = \"-\"; };\n    }\n)";
        assert_eq!(https_bundle(reversed).as_deref(), Some("com.microsoft.edgemac"));
        assert_eq!(https_bundle("(\n)"), None);
    }

    #[test]
    fn app_args_open_a_small_window() {
        assert_eq!(app_args("https://tracker.example.com/view/A-1"), ["--app=https://tracker.example.com/view/A-1".to_string(), "--window-size=960,720".to_string()]);
    }
}
