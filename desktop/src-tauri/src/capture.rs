//! Screen capture: grab the monitor under the cursor, let the user drag out a
//! region on a frozen full-screen copy, and hand the crop to the main window.
//!
//! Everything stays in memory. The frame and the crop live in `CaptureState`
//! only until the main window takes them; nothing is written to disk.

use std::io::Cursor;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use image::codecs::png::{CompressionType, FilterType, PngEncoder};
use image::{ImageEncoder, RgbaImage};
use serde::Deserialize;
use tauri::ipc::Response;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, Position, Size, State, WebviewUrl, WebviewWindowBuilder};
#[cfg(not(target_os = "macos"))]
use tauri::PhysicalSize;
#[cfg(target_os = "macos")]
use tauri::{LogicalPosition, LogicalSize};
use xcap::Monitor;

const OVERLAY: &str = "capture";

#[derive(Default)]
pub struct CaptureState {
    frame: Mutex<Option<RgbaImage>>,
    crop: Mutex<Option<Vec<u8>>>,
    main_was_visible: Mutex<bool>,
    /// Set while `start` runs, before the overlay exists to say so.
    starting: AtomicBool,
}

/// Clears `starting` however `start` returns.
struct Starting<'a>(&'a AtomicBool);

impl Drop for Starting<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
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
    // One capture at a time. A second press while this one is still hiding the
    // window would see it hidden and later fail to restore it, so it is
    // dropped; once the overlay is up, its own presence says the same.
    let state = app.state::<CaptureState>();
    if state.starting.swap(true, Ordering::AcqRel) {
        return Ok(());
    }
    let _starting = Starting(&state.starting);
    if app.get_webview_window(OVERLAY).is_some() {
        return Ok(()); // already capturing
    }
    #[cfg(target_os = "macos")]
    screen_access()?;
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
        let monitor = pick_monitor(&app)?;
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

    let (position, size) = overlay_rect(&monitor, &frame);
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
    let _ = overlay.set_position(position);
    let _ = overlay.set_size(size);
    #[cfg(target_os = "macos")]
    raise_overlay(&app, overlay);
    Ok(())
}

/// The monitor under the cursor, or the first one when the cursor can't be
/// read (Wayland keeps it from apps).
fn pick_monitor(app: &AppHandle) -> Result<Monitor, String> {
    let under_cursor = app.cursor_position().ok().and_then(|c| {
        let (x, y) = cursor_point(app, c);
        Monitor::from_point(x, y).ok()
    });
    match under_cursor {
        Some(monitor) => Ok(monitor),
        None => Monitor::all()
            .map_err(|e| e.to_string())?
            .into_iter()
            .next()
            .ok_or_else(|| "no monitor found".to_string()),
    }
}

// xcap lays monitors out in physical pixels, except on macOS where it uses
// points, the same units the window server does.
#[cfg(not(target_os = "macos"))]
fn cursor_point(_app: &AppHandle, c: PhysicalPosition<f64>) -> (i32, i32) {
    (c.x as i32, c.y as i32)
}

#[cfg(target_os = "macos")]
fn cursor_point(app: &AppHandle, c: PhysicalPosition<f64>) -> (i32, i32) {
    let scale = app
        .monitor_from_point(c.x, c.y)
        .ok()
        .flatten()
        .map_or(1.0, |m| m.scale_factor());
    ((c.x / scale) as i32, (c.y / scale) as i32)
}

/// Where the overlay goes so it covers exactly the captured monitor.
#[cfg(not(target_os = "macos"))]
fn overlay_rect(monitor: &Monitor, frame: &RgbaImage) -> (Position, Size) {
    let (x, y) = (monitor.x().unwrap_or(0), monitor.y().unwrap_or(0));
    (
        PhysicalPosition::new(x, y).into(),
        PhysicalSize::new(frame.width(), frame.height()).into(),
    )
}

/// On a Mac the monitor is measured in points and the frame in pixels (twice as
/// many on a Retina screen), so the overlay is placed in points.
#[cfg(target_os = "macos")]
fn overlay_rect(monitor: &Monitor, frame: &RgbaImage) -> (Position, Size) {
    let (x, y) = (monitor.x().unwrap_or(0), monitor.y().unwrap_or(0));
    let scale = f64::from(monitor.scale_factor().unwrap_or(1.0)).max(1.0);
    let w = monitor.width().map_or(f64::from(frame.width()) / scale, f64::from);
    let h = monitor.height().map_or(f64::from(frame.height()) / scale, f64::from);
    (
        LogicalPosition::new(f64::from(x), f64::from(y)).into(),
        LogicalSize::new(w, h).into(),
    )
}

/// macOS hands back an image of the bare desktop unless the user has allowed
/// screen recording, so ask first. The system prompt (or System Settings)
/// takes it from there; the grant applies once ShotShield is reopened.
#[cfg(target_os = "macos")]
fn screen_access() -> Result<(), String> {
    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGPreflightScreenCaptureAccess() -> bool;
        fn CGRequestScreenCaptureAccess() -> bool;
    }
    // SAFETY: both take no arguments and only read or prompt for the app's own permission.
    if unsafe { CGPreflightScreenCaptureAccess() } {
        return Ok(());
    }
    unsafe { CGRequestScreenCaptureAccess() };
    Err("ShotShield needs permission to record the screen. Allow it in System Settings, \
         Privacy & Security, Screen Recording, then quit and reopen ShotShield."
        .into())
}

/// Lift the overlay above the menu bar and the Dock, where the system's own
/// screenshot tool draws. An always-on-top window still sits under both, and
/// whatever they hide couldn't be selected.
#[cfg(target_os = "macos")]
fn raise_overlay(app: &AppHandle, overlay: tauri::WebviewWindow) {
    // AppKit windows may only be touched on the main thread.
    let _ = app.run_on_main_thread(move || {
        let Ok(ptr) = overlay.ns_window() else { return };
        const SCREEN_SAVER_LEVEL: isize = 1000;
        // SAFETY: ns_window is the overlay's live NSWindow, and this runs on the main thread.
        unsafe {
            let window = &*(ptr as *mut objc2::runtime::AnyObject);
            let _: () = objc2::msg_send![window, setLevel: SCREEN_SAVER_LEVEL];
        }
    });
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
