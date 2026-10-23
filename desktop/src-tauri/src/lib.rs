#[cfg(windows)]
mod capture;

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
    // even with ShotShield in the background.
    #[cfg(windows)]
    {
        use tauri::{Emitter, Manager};
        use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

        let hotkey = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyR);
        builder = builder
            .manage(capture::CaptureState::default())
            .plugin(
                tauri_plugin_global_shortcut::Builder::new()
                    .with_handler(move |app, shortcut, event| {
                        if shortcut != &hotkey || event.state() != ShortcutState::Pressed {
                            return;
                        }
                        let app = app.clone();
                        std::thread::spawn(move || {
                            if let Err(e) = capture::start(app.clone()) {
                                if let Some(main) = app.get_webview_window("main") {
                                    let _ = main.emit("capture-failed", e);
                                }
                            }
                        });
                    })
                    .build(),
            )
            .setup(move |app| {
                // Another app may own the combination already; the in-app
                // Capture button still works, so don't fail startup over it.
                if let Err(e) = app.global_shortcut().register(hotkey) {
                    eprintln!("ShotShield: couldn't register Ctrl+Alt+R: {e}");
                }
                Ok(())
            })
            .invoke_handler(tauri::generate_handler![
                capture::capture_start,
                capture::capture_frame,
                capture::capture_finish,
                capture::capture_cancel,
                capture::capture_take,
            ]);
    }

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
