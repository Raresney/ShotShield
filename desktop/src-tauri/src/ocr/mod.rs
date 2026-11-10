//! Text recognition with the OCR engine built into the operating system:
//! Windows.Media.Ocr on Windows, Vision on macOS.
//!
//! Both run on the device like Tesseract does, but read phone photos of ID
//! cards far better: they keep lines that sit on a tinted background, where
//! Tesseract drops them. The front end treats this as one more pass and merges
//! it with its own, so a machine without the engine simply falls back.

use serde::Serialize;
use tauri::ipc::{InvokeBody, Request};

#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "macos")]
use macos::recognize;
#[cfg(windows)]
mod windows;
#[cfg(windows)]
use self::windows::recognize;

#[derive(Serialize, Debug, PartialEq)]
pub struct Word {
    text: String,
    x: f32,
    y: f32,
    w: f32,
    h: f32,
}

/// One recognized line, its words in reading order.
#[derive(Serialize)]
pub struct Line {
    words: Vec<Word>,
}

fn header(request: &Request<'_>, name: &str) -> Result<i32, String> {
    request
        .headers()
        .get(name)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse().ok())
        .ok_or_else(|| format!("missing {name}"))
}

fn check_size(rgba: &[u8], width: i32, height: i32) -> Result<(), String> {
    if width <= 0 || height <= 0 || rgba.len() != width as usize * height as usize * 4 {
        return Err("bad image size".into());
    }
    Ok(())
}

/// Read raw RGBA pixels (the request body) of the size given in the `width`
/// and `height` headers. Returns the lines found, empty if there were none.
#[tauri::command]
pub async fn ocr_native(request: Request<'_>) -> Result<Vec<Line>, String> {
    let width = header(&request, "width")?;
    let height = header(&request, "height")?;
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected raw pixels".into());
    };
    let rgba = bytes.clone();
    check_size(&rgba, width, height)?;
    tauri::async_runtime::spawn_blocking(move || recognize(rgba, width, height))
        .await
        .map_err(|e| e.to_string())?
}

/// The words of a line with where each sits in it, counted in UTF-16 code
/// units: the unit NSString ranges use. Words are split on whitespace.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn utf16_words(line: &str) -> Vec<(String, usize, usize)> {
    let mut out = Vec::new();
    let mut at = 0;
    let mut current: Option<(String, usize)> = None;
    for c in line.chars() {
        if c.is_whitespace() {
            if let Some((text, start)) = current.take() {
                out.push((text, start, at - start));
            }
        } else {
            current.get_or_insert_with(|| (String::new(), at)).0.push(c);
        }
        at += c.len_utf16();
    }
    if let Some((text, start)) = current {
        out.push((text, start, at - start));
    }
    out
}

/// A Vision box (normalized to 0..1, origin at the bottom-left) in image
/// pixels with the origin at the top-left, as the front end expects.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn to_pixels(text: String, (x, y, w, h): (f64, f64, f64, f64), width: i32, height: i32) -> Word {
    let (iw, ih) = (f64::from(width), f64::from(height));
    Word {
        text,
        x: (x * iw) as f32,
        y: ((1.0 - y - h) * ih) as f32,
        w: (w * iw) as f32,
        h: (h * ih) as f32,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_a_line_into_words_with_utf16_ranges() {
        let words = utf16_words("CNP  1960209 Ștefan");
        assert_eq!(
            words,
            vec![("CNP".into(), 0, 3), ("1960209".into(), 5, 7), ("Ștefan".into(), 13, 6)]
        );
        // Characters outside the BMP take two UTF-16 units.
        assert_eq!(utf16_words("a 😀b c"), vec![("a".into(), 0, 1), ("😀b".into(), 2, 3), ("c".into(), 6, 1)]);
        assert!(utf16_words("   ").is_empty());
    }

    #[test]
    fn flips_a_vision_box_into_top_left_pixels() {
        let word = to_pixels("x".into(), (0.25, 0.5, 0.5, 0.25), 400, 200);
        assert_eq!(word, Word { text: "x".into(), x: 100.0, y: 50.0, w: 200.0, h: 50.0 });
    }

    #[test]
    fn rejects_pixels_that_dont_match_the_size() {
        assert!(check_size(&[0; 16], 2, 2).is_ok());
        assert!(check_size(&[0; 15], 2, 2).is_err());
        assert!(check_size(&[], 0, 0).is_err());
    }
}
