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
#[cfg(not(target_os = "linux"))]
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

#[derive(Deserialize, Debug, PartialEq)]
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

    let (frame, position, size) = match grab(&app) {
        Ok(v) => v,
        Err(e) => {
            restore(&app);
            return Err(e);
        }
    };
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
    // Wayland ignores where an app asks to put its window; fullscreen is the
    // one way to cover a whole monitor there (and works the same on X11).
    #[cfg(target_os = "linux")]
    let _ = overlay.set_fullscreen(true);
    Ok(())
}

/// The frozen frame of one monitor, and where the overlay goes to cover it.
#[cfg(not(target_os = "linux"))]
fn grab(app: &AppHandle) -> Result<(RgbaImage, Position, Size), String> {
    let monitor = pick_monitor(app)?;
    let frame = monitor.capture_image().map_err(|e| e.to_string())?;
    let (position, size) = overlay_rect(&monitor, &frame);
    Ok((frame, position, size))
}

/// On Linux the desktop's own screenshot portal takes the picture (the only
/// way on Wayland, and it needs no PipeWire). It shoots every monitor at once,
/// so the frame is cut down to the one the overlay will cover.
#[cfg(target_os = "linux")]
fn grab(app: &AppHandle) -> Result<(RgbaImage, Position, Size), String> {
    let shot = crate::portal::screenshot()?;
    let monitors = app.available_monitors().map_err(|e| e.to_string())?;
    let target = app
        .cursor_position()
        .ok()
        .and_then(|c| app.monitor_from_point(c.x, c.y).ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten())
        .or_else(|| monitors.first().cloned());
    let Some(target) = target else {
        let (w, h) = (shot.width(), shot.height());
        return Ok((shot, PhysicalPosition::new(0, 0).into(), PhysicalSize::new(w, h).into()));
    };
    let areas: Vec<Area> = monitors.iter().map(monitor_area).collect();
    let frame = match crop_to(&areas, monitor_area(&target), shot.width(), shot.height()) {
        Some(r) => image::imageops::crop_imm(&shot, r.x, r.y, r.w, r.h).to_image(),
        None => shot,
    };
    Ok((frame, (*target.position()).into(), (*target.size()).into()))
}

/// A monitor's place on the desktop, in physical pixels (left of or above the
/// primary one is negative).
#[derive(Clone, Copy)]
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
struct Area {
    x: i64,
    y: i64,
    w: i64,
    h: i64,
}

#[cfg(target_os = "linux")]
fn monitor_area(m: &tauri::Monitor) -> Area {
    let (p, s) = (m.position(), m.size());
    Area { x: p.x.into(), y: p.y.into(), w: s.width.into(), h: s.height.into() }
}

/// Where `target` sits in a screenshot of all `monitors`, scaled to the
/// screenshot's own size (a portal may shoot in logical rather than physical
/// pixels). None when it is the whole picture or can't be placed.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn crop_to(monitors: &[Area], target: Area, shot_w: u32, shot_h: u32) -> Option<Rect> {
    let left = monitors.iter().map(|m| m.x).min()?;
    let top = monitors.iter().map(|m| m.y).min()?;
    let right = monitors.iter().map(|m| m.x + m.w).max()?;
    let bottom = monitors.iter().map(|m| m.y + m.h).max()?;
    let (all_w, all_h) = (right - left, bottom - top);
    if all_w <= 0 || all_h <= 0 || (target.w == all_w && target.h == all_h) {
        return None;
    }
    let sx = f64::from(shot_w) / all_w as f64;
    let sy = f64::from(shot_h) / all_h as f64;
    let x = (((target.x - left) as f64 * sx).round() as u32).min(shot_w);
    let y = (((target.y - top) as f64 * sy).round() as u32).min(shot_h);
    let w = ((target.w as f64 * sx).round() as u32).min(shot_w - x);
    let h = ((target.h as f64 * sy).round() as u32).min(shot_h - y);
    (w > 0 && h > 0).then_some(Rect { x, y, w, h })
}

/// The monitor under the cursor, or the first one when the cursor can't be
/// read.
#[cfg(not(target_os = "linux"))]
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
#[cfg(not(any(target_os = "macos", target_os = "linux")))]
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
#[cfg(not(any(target_os = "macos", target_os = "linux")))]
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

#[cfg(test)]
mod tests {
    use super::*;

    const fn area(x: i64, y: i64, w: i64, h: i64) -> Area {
        Area { x, y, w, h }
    }

    #[test]
    fn one_monitor_is_the_whole_shot() {
        let only = area(0, 0, 1920, 1080);
        assert_eq!(crop_to(&[only], only, 1920, 1080), None);
    }

    #[test]
    fn cuts_the_right_monitor_out_of_a_side_by_side_shot() {
        let (left, right) = (area(0, 0, 1920, 1080), area(1920, 0, 2560, 1440));
        let cut = crop_to(&[left, right], right, 4480, 1440);
        assert_eq!(cut, Some(Rect { x: 1920, y: 0, w: 2560, h: 1440 }));
    }

    #[test]
    fn handles_a_monitor_left_of_the_primary() {
        let (side, primary) = (area(-1280, 0, 1280, 1024), area(0, 0, 1920, 1080));
        let cut = crop_to(&[side, primary], primary, 3200, 1080);
        assert_eq!(cut, Some(Rect { x: 1280, y: 0, w: 1920, h: 1080 }));
    }

    #[test]
    fn scales_when_the_portal_shoots_in_logical_pixels() {
        // Two 2x monitors, shot at half their physical size.
        let (a, b) = (area(0, 0, 2560, 1600), area(2560, 0, 2560, 1600));
        let cut = crop_to(&[a, b], b, 2560, 800);
        assert_eq!(cut, Some(Rect { x: 1280, y: 0, w: 1280, h: 800 }));
    }
}
