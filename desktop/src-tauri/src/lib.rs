#[cfg(desktop)]
mod capture;
#[cfg(windows)]
mod ocr;
#[cfg(target_os = "linux")]
mod portal;
#[cfg(desktop)]
mod tray;

/// Start a screen capture off the calling thread; a failure is reported to the
/// main window, which says so if nothing else is on screen.
#[cfg(desktop)]
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

/// The capture shortcut as the tray menu shows it.
#[cfg(all(desktop, target_os = "macos"))]
pub(crate) const SHORTCUT_LABEL: &str = "⌃⌥R";
#[cfg(all(desktop, not(target_os = "macos")))]
pub(crate) const SHORTCUT_LABEL: &str = "Ctrl+Alt+R";

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

    // Screen capture. Ctrl+Alt+R (Control+Option+R on a Mac) works
    // system-wide, even with ShotShield in the background, and the tray keeps
    // it running with the window closed. Wayland doesn't let an app grab a
    // global shortcut, so there it's the capture button and the tray menu.
    #[cfg(desktop)]
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
            .on_window_event(tray::on_window_event);
    }

    // The Windows OCR engine only exists on Windows; elsewhere the page asks
    // for it once, gets "not found" and stops asking.
    #[cfg(windows)]
    {
        builder = builder.invoke_handler(tauri::generate_handler![
            capture::capture_start,
            capture::capture_frame,
            capture::capture_finish,
            capture::capture_cancel,
            capture::capture_take,
            ocr::ocr_native,
            tray::set_background,
            tray::autostart_enabled,
            tray::set_autostart,
        ]);
    }
    #[cfg(all(desktop, not(windows)))]
    {
        builder = builder.invoke_handler(tauri::generate_handler![
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

    let app = builder
        .setup(|app| {
            use tauri::Manager;
            // The main window starts hidden (see tauri.conf.json) so a start at
            // login can stay in the tray; every other start shows it here.
            #[cfg_attr(not(desktop), allow(unused_mut))]
            let mut to_tray = cfg!(desktop) && std::env::args().any(|a| a == "--hidden");
            #[cfg(desktop)]
            {
                use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};
                // Another app may own the combination already (or, on Wayland,
                // the compositor refuses it); the in-app Capture button still
                // works, so don't fail startup over it.
                let hotkey = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyR);
                if let Err(e) = app.global_shortcut().register(hotkey) {
                    eprintln!("ShotShield: couldn't register {SHORTCUT_LABEL}: {e}");
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
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|_app, _event| {
        // Closing the window to the tray only hides it; on a Mac a click on the
        // Dock icon is how people expect to get it back.
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Reopen { .. } = _event {
            tray::show_main(_app);
        }
    });
}
