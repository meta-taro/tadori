//! 窓の側で出す言葉（ダイアログ・起動の誤り）の言語。英語を基本にし、OS の言語が日本語なら日本語。
//! TADORI_LANG（en / ja）があればそれを使う。画面と裏の tadori serve にも同じ言語を渡す。

/// 言語の名前（ja・ja-JP・ja_JP.UTF-8 など）が日本語か
pub fn is_japanese(name: &str) -> bool {
    name.trim().to_ascii_lowercase().starts_with("ja")
}

/// TADORI_LANG → OS の言語 → 英語、で決めた言語（"en" か "ja"）
pub fn current() -> &'static str {
    if let Ok(explicit) = std::env::var("TADORI_LANG") {
        if is_japanese(&explicit) {
            return "ja";
        }
        if explicit.trim().to_ascii_lowercase().starts_with("en") {
            return "en";
        }
    }
    match sys_locale::get_locale() {
        Some(locale) if is_japanese(&locale) => "ja",
        _ => "en",
    }
}

/// いまの言語の文を選ぶ
pub fn tr(en: &'static str, ja: &'static str) -> &'static str {
    if current() == "ja" { ja } else { en }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 日本語の言語の名前を見分ける() {
        assert!(is_japanese("ja-JP"));
        assert!(is_japanese("ja_JP.UTF-8"));
        assert!(!is_japanese("en-US"));
        assert!(!is_japanese(""));
    }
}
