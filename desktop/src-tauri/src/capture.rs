//! Screen capture: grab the monitor under the cursor, let the user drag out a
//! region on a frozen full-screen copy, and hand the crop to the main window.
//!
//! Everything stays in memory. The frame and the crop live in `CaptureState`
//! only until the main window takes them; nothing is written to disk.

use std::io::Cursor;
use std::sync::Mutex;
use std::time::Duration;

use image::codecs::png::{CompressionType, FilterType, PngEncoder};
use image::{ImageEncoder, RgbaImage};
use serde::Deserialize;
use tauri::ipc::Response;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, State, WebviewUrl, WebviewWindowBuilder};
use xcap::Monitor;

const OVERLAY: &str = "capture";

#[derive(Default)]
pub struct CaptureState {
    frame: Mutex<Option<RgbaImage>>,
    crop: Mutex<Option<Vec<u8>>>,
    main_was_visible: Mutex<bool>,
}

#[derive(Deserialize)]
pub struct Rect {
    x: u32,
    y: u32,
    w: u32,
    h: u32,
}

fn png(img: &RgbaImage, fast: bool) -> Result<Vec<u8>, String> {
    let mut out = Cursor::new(Vec::new());
    let (compression, filter) = if fast {
        (CompressionType::Fast, FilterType::NoFilter)
    } else {
        (CompressionType::Default, FilterType::Adaptive)
    };
    PngEncoder::new_with_quality(&mut out, compression, filter)
        .write_image(img, img.width(), img.height(), image::ExtendedColorType::Rgba8)
        .map_err(|e| e.to_string())?;
    Ok(out.into_inner())
}

/// Hide ShotShield, grab the monitor under the cursor and open the overlay.
/// Runs off the main thread: the sleep must not stall the event loop that
/// actually hides the window.
pub fn start(app: AppHandle) -> Result<(), String> {
    if app.get_webview_window(OVERLAY).is_some() {
        return Ok(()); // already capturing
    }
    let main = app.get_webview_window("main");
    let was_visible = main.as_ref().is_some_and(|w| w.is_visible().unwrap_or(false));
    if let Some(w) = &main {
        let _ = w.hide();
        // Give the compositor time to drop our window before grabbing the screen.
        std::thread::sleep(Duration::from_millis(220));
    }

    let restore = |app: &AppHandle| {
        if was_visible {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
            }
        }
    };

    let shot = (|| -> Result<(Monitor, RgbaImage), String> {
        let cursor = app.cursor_position().map_err(|e| e.to_string())?;
        let monitor = Monitor::from_point(cursor.x as i32, cursor.y as i32)
            .or_else(|_| {
                Monitor::all().and_then(|all| {
                    all.into_iter()
                        .next()
                        .ok_or_else(|| xcap::XCapError::new("no monitor"))
                })
            })
            .map_err(|e| e.to_string())?;
        let frame = monitor.capture_image().map_err(|e| e.to_string())?;
        Ok((monitor, frame))
    })();
    let (monitor, frame) = match shot {
        Ok(v) => v,
        Err(e) => {
            restore(&app);
            return Err(e);
        }
    };

    let (x, y) = (monitor.x().unwrap_or(0), monitor.y().unwrap_or(0));
    let (w, h) = (frame.width(), frame.height());
    let state = app.state::<CaptureState>();
    *state.frame.lock().unwrap() = Some(frame);
    *state.main_was_visible.lock().unwrap() = was_visible;

    let overlay = WebviewWindowBuilder::new(&app, OVERLAY, WebviewUrl::App("capture.html".into()))
        .title("ShotShield capture")
        .decorations(false)
        .resizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .shadow(false)
        .visible(false) // the page shows itself once the frozen frame is painted
        .build()
        .map_err(|e| {
            restore(&app);
            e.to_string()
        })?;
    let _ = overlay.set_position(PhysicalPosition::new(x, y));
    let _ = overlay.set_size(PhysicalSize::new(w, h));
    Ok(())
}

fn finish(app: &AppHandle, delivered: bool) {
    if let Some(w) = app.get_webview_window(OVERLAY) {
        let _ = w.close();
    }
    let state = app.state::<CaptureState>();
    *state.frame.lock().unwrap() = None;
    let was_visible = *state.main_was_visible.lock().unwrap();
    if let Some(main) = app.get_webview_window("main") {
        if delivered {
            let _ = main.show();
            let _ = main.unminimize();
            let _ = main.set_focus();
            let _ = main.emit("capture-ready", ());
        } else if was_visible {
            let _ = main.show();
        }
    }
}

#[tauri::command]
pub async fn capture_start(app: AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || start(app))
        .await
        .map_err(|e| e.to_string())?
}

/// The frozen frame for the overlay, as a quickly-encoded PNG.
#[tauri::command]
pub fn capture_frame(state: State<'_, CaptureState>) -> Result<Response, String> {
    let guard = state.frame.lock().unwrap();
    let frame = guard.as_ref().ok_or("no capture in progress")?;
    Ok(Response::new(png(frame, true)?))
}

/// Crop the frozen frame to `rect` (frame pixels) and pass it to the main window.
#[tauri::command]
pub fn capture_finish(app: AppHandle, state: State<'_, CaptureState>, rect: Rect) -> Result<(), String> {
    let cropped = {
        let guard = state.frame.lock().unwrap();
        let frame = guard.as_ref().ok_or("no capture in progress")?;
        let x = rect.x.min(frame.width().saturating_sub(1));
        let y = rect.y.min(frame.height().saturating_sub(1));
        let w = rect.w.clamp(1, frame.width() - x);
        let h = rect.h.clamp(1, frame.height() - y);
        image::imageops::crop_imm(frame, x, y, w, h).to_image()
    };
    *state.crop.lock().unwrap() = Some(png(&cropped, false)?);
    finish(&app, true);
    Ok(())
}

#[tauri::command]
pub fn capture_cancel(app: AppHandle, state: State<'_, CaptureState>) {
    *state.crop.lock().unwrap() = None;
    finish(&app, false);
}

/// Hand the cropped PNG to the main window, once.
#[tauri::command]
pub fn capture_take(state: State<'_, CaptureState>) -> Result<Response, String> {
    let bytes = state.crop.lock().unwrap().take().ok_or("nothing captured")?;
    Ok(Response::new(bytes))
}
