// The tray icon, close-to-tray and start-at-login: together they keep the
// Ctrl+Alt+R capture one keypress away with the window closed.

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{App, AppHandle, Manager, State, Window, WindowEvent};
use tauri_plugin_autostart::ManagerExt;

/// Passed by the login item, so a start at login goes straight to the tray.
pub const HIDDEN_ARG: &str = "--hidden";

/// Whether closing the main window hides it to the tray instead of quitting.
/// The window sets it from its settings on startup and whenever it changes.
pub struct Background(AtomicBool);

impl Default for Background {
    fn default() -> Self {
        Self(AtomicBool::new(true))
    }
}

pub fn setup(app: &App) -> tauri::Result<()> {
    let capture = MenuItem::with_id(app, "capture", "Capture screen\tCtrl+Alt+R", true, None::<&str>)?;
    let open = MenuItem::with_id(app, "open", "Open ShotShield", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit ShotShield", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&capture, &open, &PredefinedMenuItem::separator(app)?, &quit])?;

    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip("ShotShield · Ctrl+Alt+R to capture")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "capture" => crate::start_capture(app.clone()),
            "open" => show_main(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                show_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

pub fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

/// Closing the main window hides it while the tray is on, so the hotkey stays
/// live. With the tray off it quits outright: the tray icon would otherwise keep
/// the process alive with nothing left to open.
pub fn on_window_event(window: &Window, event: &WindowEvent) {
    if let WindowEvent::CloseRequested { api, .. } = event {
        if window.label() != "main" {
            return;
        }
        if window.state::<Background>().0.load(Ordering::Relaxed) {
            api.prevent_close();
            let _ = window.hide();
        } else {
            window.app_handle().exit(0);
        }
    }
}

#[tauri::command]
pub fn set_background(state: State<'_, Background>, enabled: bool) {
    state.0.store(enabled, Ordering::Relaxed);
}

#[tauri::command]
pub fn autostart_enabled(app: AppHandle) -> Result<bool, String> {
    app.autolaunch().is_enabled().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_autostart(app: AppHandle, enabled: bool) -> Result<(), String> {
    let launcher = app.autolaunch();
    if enabled { launcher.enable() } else { launcher.disable() }.map_err(|e| e.to_string())
}
