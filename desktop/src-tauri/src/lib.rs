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

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
