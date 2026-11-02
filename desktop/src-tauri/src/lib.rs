#[cfg(windows)]
mod capture;
#[cfg(windows)]
mod tray;

/// Start a screen capture off the calling thread; a failure is reported to the
/// main window, which says so if nothing else is on screen.
#[cfg(windows)]
pub(crate) fn start_capture(app: tauri::AppHandle) {
    use tauri::{Emitter, Manager};
    std::thread::spawn(move || {
        if let Err(e) = capture::start(app.clone()) {
            if let Some(main) = app.get_webview_window("main") {
                let _ = main.emit("capture-failed", e);
            }
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    // The updater and the relaunch-after-install it needs are desktop-only, as
    // is the native Save As dialog (dialog picks the path, fs writes the PNG).
    #[cfg(desktop)]
    {
        builder = builder
            .plugin(tauri_plugin_updater::Builder::new().build())
            .plugin(tauri_plugin_process::init())
            .plugin(tauri_plugin_dialog::init())
            .plugin(tauri_plugin_fs::init());
    }

    // Screen capture (Windows for now: the Linux backend needs PipeWire, which
    // the release runner doesn't build against). Ctrl+Alt+R works system-wide,
    // even with ShotShield in the background, and the tray keeps it running
    // with the window closed.
    #[cfg(windows)]
    {
        use tauri_plugin_global_shortcut::{Code, Modifiers, Shortcut, ShortcutState};

        let hotkey = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyR);
        builder = builder
            .manage(capture::CaptureState::default())
            .manage(tray::Background::default())
            .plugin(
                tauri_plugin_global_shortcut::Builder::new()
                    .with_handler(move |app, shortcut, event| {
                        if shortcut == &hotkey && event.state() == ShortcutState::Pressed {
                            start_capture(app.clone());
                        }
                    })
                    .build(),
            )
            .plugin(tauri_plugin_autostart::Builder::new().arg(tray::HIDDEN_ARG).build())
            .on_window_event(tray::on_window_event)
            .invoke_handler(tauri::generate_handler![
                capture::capture_start,
                capture::capture_frame,
                capture::capture_finish,
                capture::capture_cancel,
                capture::capture_take,
                tray::set_background,
                tray::autostart_enabled,
                tray::set_autostart,
            ]);
    }

    builder
        .setup(|app| {
            use tauri::Manager;
            // The main window starts hidden (see tauri.conf.json) so a start at
            // login can stay in the tray; every other start shows it here.
            #[cfg_attr(not(windows), allow(unused_mut))]
            let mut to_tray = cfg!(windows) && std::env::args().any(|a| a == "--hidden");
            #[cfg(windows)]
            {
                use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};
                // Another app may own the combination already; the in-app
                // Capture button still works, so don't fail startup over it.
                let hotkey = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyR);
                if let Err(e) = app.global_shortcut().register(hotkey) {
                    eprintln!("ShotShield: couldn't register Ctrl+Alt+R: {e}");
                }
                if let Err(e) = tray::setup(app) {
                    // No tray to come back from: never start hidden.
                    eprintln!("ShotShield: couldn't create the tray icon: {e}");
                    to_tray = false;
                }
            }
            if !to_tray {
                if let Some(main) = app.get_webview_window("main") {
                    let _ = main.show();
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
