fn main() {
    // Screen capture (with the tray and start-at-login that keep its shortcut
    // ready) builds on Windows and macOS. xcap's Linux backend needs a newer
    // PipeWire than the oldest distro the Linux release still runs on.
    println!("cargo::rustc-check-cfg=cfg(capture)");
    let os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    if os == "windows" || os == "macos" {
        println!("cargo:rustc-cfg=capture");
    }
    tauri_build::build()
}
