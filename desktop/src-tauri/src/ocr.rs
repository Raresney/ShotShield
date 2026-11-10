//! Text recognition with the OCR engine built into Windows (Windows.Media.Ocr).
//!
//! It runs on the device like Tesseract does, but reads phone photos of ID
//! cards far better: it keeps lines that sit on a tinted background, where
//! Tesseract drops them. The front end treats this as one more pass and merges
//! it with its own, so a machine without an OCR language simply falls back.

use serde::Serialize;
use tauri::ipc::{InvokeBody, Request};
use windows::Globalization::Language;
use windows::Graphics::Imaging::{BitmapAlphaMode, BitmapPixelFormat, SoftwareBitmap};
use windows::Media::Ocr::OcrEngine;
use windows::Storage::Streams::DataWriter;

#[derive(Serialize)]
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

fn engine() -> Result<OcrEngine, String> {
    // The user's own languages first; English is the usual fallback that ships
    // with every install that has OCR at all.
    if let Ok(e) = OcrEngine::TryCreateFromUserProfileLanguages() {
        return Ok(e);
    }
    let en = Language::CreateLanguage(&"en-US".into()).map_err(|e| e.to_string())?;
    OcrEngine::TryCreateFromLanguage(&en).map_err(|_| "no OCR language installed".to_string())
}

fn header(request: &Request<'_>, name: &str) -> Result<i32, String> {
    request
        .headers()
        .get(name)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse().ok())
        .ok_or_else(|| format!("missing {name}"))
}

fn recognize(mut rgba: Vec<u8>, width: i32, height: i32) -> Result<Vec<Line>, String> {
    if width <= 0 || height <= 0 || rgba.len() != width as usize * height as usize * 4 {
        return Err("bad image size".into());
    }
    let max = OcrEngine::MaxImageDimension().map_err(|e| e.to_string())? as i32;
    if width > max || height > max {
        return Err("image too large for the system OCR".into());
    }
    // The canvas hands over RGBA; the bitmap wants BGRA.
    for px in rgba.chunks_exact_mut(4) {
        px.swap(0, 2);
    }
    let engine = engine()?;
    let run = || -> windows::core::Result<Vec<Line>> {
        let writer = DataWriter::new()?;
        writer.WriteBytes(&rgba)?;
        let buffer = writer.DetachBuffer()?;
        let bitmap = SoftwareBitmap::CreateCopyWithAlphaFromBuffer(
            &buffer,
            BitmapPixelFormat::Bgra8,
            width,
            height,
            BitmapAlphaMode::Ignore,
        )?;
        let result = engine.RecognizeAsync(&bitmap)?.join()?;
        let lines = result.Lines()?;
        let mut out = Vec::with_capacity(lines.Size()? as usize);
        for i in 0..lines.Size()? {
            let words = lines.GetAt(i)?.Words()?;
            let mut line = Line { words: Vec::with_capacity(words.Size()? as usize) };
            for j in 0..words.Size()? {
                let word = words.GetAt(j)?;
                let r = word.BoundingRect()?;
                line.words.push(Word { text: word.Text()?.to_string(), x: r.X, y: r.Y, w: r.Width, h: r.Height });
            }
            out.push(line);
        }
        Ok(out)
    };
    run().map_err(|e| e.to_string())
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
    tauri::async_runtime::spawn_blocking(move || recognize(rgba, width, height))
        .await
        .map_err(|e| e.to_string())?
}
