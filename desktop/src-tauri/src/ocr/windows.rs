//! Windows.Media.Ocr, the engine that ships with Windows.

use windows::Globalization::Language;
use windows::Graphics::Imaging::{BitmapAlphaMode, BitmapPixelFormat, SoftwareBitmap};
use windows::Media::Ocr::OcrEngine;
use windows::Storage::Streams::DataWriter;

use super::{Line, Word};

fn engine() -> Result<OcrEngine, String> {
    // The user's own languages first; English is the usual fallback that ships
    // with every install that has OCR at all.
    if let Ok(e) = OcrEngine::TryCreateFromUserProfileLanguages() {
        return Ok(e);
    }
    let en = Language::CreateLanguage(&"en-US".into()).map_err(|e| e.to_string())?;
    OcrEngine::TryCreateFromLanguage(&en).map_err(|_| "no OCR language installed".to_string())
}

pub fn recognize(mut rgba: Vec<u8>, width: i32, height: i32) -> Result<Vec<Line>, String> {
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
