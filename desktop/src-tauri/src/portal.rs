//! A screenshot from the desktop itself, through the xdg-desktop-portal
//! Screenshot interface on the session bus. It is how apps take screenshots on
//! Wayland, works on X11 desktops that run a portal too, and needs no PipeWire.
//!
//! The portal hands back a file:// URI to a PNG it wrote. ShotShield reads it
//! into memory and deletes it straight away, so the capture leaves no copy.

use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

use image::RgbaImage;
use zbus::blocking::{Connection, Proxy};
use zbus::zvariant::{OwnedObjectPath, OwnedValue, Value};

const DESKTOP: &str = "org.freedesktop.portal.Desktop";
const DESKTOP_PATH: &str = "/org/freedesktop/portal/desktop";
const REQUEST: &str = "org.freedesktop.portal.Request";

const NO_PORTAL: &str = "the desktop's screenshot portal isn't available. \
    Install xdg-desktop-portal with the backend for your desktop (GNOME, KDE, wlroots…)";

/// Take a screenshot of every monitor, without the portal's own dialog.
pub fn screenshot() -> Result<RgbaImage, String> {
    let conn = Connection::session().map_err(|e| format!("no D-Bus session bus: {e}"))?;

    // The portal answers on a Request object whose path it derives from our
    // bus name and a token we choose. Listen there before asking, so a quick
    // answer can't be missed.
    let sender = conn
        .unique_name()
        .ok_or("no D-Bus name")?
        .as_str()
        .trim_start_matches(':')
        .replace('.', "_");
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.subsec_nanos());
    let token = format!("shotshield{}_{nanos}", std::process::id());
    let expected = format!("{DESKTOP_PATH}/request/{sender}/{token}");
    let request = Proxy::new(&conn, DESKTOP, expected.as_str(), REQUEST).map_err(|e| e.to_string())?;
    let mut responses = request.receive_signal("Response").map_err(|e| e.to_string())?;

    let mut options: HashMap<&str, Value> = HashMap::new();
    options.insert("handle_token", Value::from(token.as_str()));
    options.insert("interactive", Value::from(false));
    let reply = conn
        .call_method(Some(DESKTOP), DESKTOP_PATH, Some("org.freedesktop.portal.Screenshot"), "Screenshot", &("", options))
        .map_err(|e| format!("{NO_PORTAL} ({e})"))?;
    let handle: OwnedObjectPath = reply.body().deserialize().map_err(|e| e.to_string())?;

    // An old portal may ignore the token and pick its own path.
    let message = if handle.as_str() == expected {
        responses.next()
    } else {
        let request = Proxy::new(&conn, DESKTOP, handle.as_str(), REQUEST).map_err(|e| e.to_string())?;
        let mut responses = request.receive_signal("Response").map_err(|e| e.to_string())?;
        responses.next()
    }
    .ok_or("the screenshot portal closed without answering")?;

    let (code, mut results): (u32, HashMap<String, OwnedValue>) =
        message.body().deserialize().map_err(|e| e.to_string())?;
    match code {
        0 => {}
        1 => return Err("the screenshot was cancelled".into()),
        _ => return Err("the desktop refused the screenshot. Check that ShotShield may take screenshots in your privacy settings".into()),
    }
    let uri = results
        .remove("uri")
        .and_then(|v| String::try_from(v).ok())
        .ok_or("the screenshot portal sent no image")?;
    let path = file_path(&uri).ok_or_else(|| format!("the screenshot portal sent an unusable location: {uri}"))?;

    let bytes = std::fs::read(&path).map_err(|e| e.to_string());
    let _ = std::fs::remove_file(&path);
    let image = image::load_from_memory(&bytes?).map_err(|e| format!("couldn't read the screenshot: {e}"))?;
    Ok(image.to_rgba8())
}

/// The local path in a file:// URI, with %XX escapes decoded.
fn file_path(uri: &str) -> Option<std::path::PathBuf> {
    let rest = uri.strip_prefix("file://")?;
    // "file://host/path": only the local host is ours to read.
    let path = if rest.starts_with('/') { rest } else { rest.strip_prefix("localhost")? };
    let bytes = path.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            // A cut-off or non-hex escape means the URI is broken: refuse it.
            let hex = bytes.get(i + 1..i + 3).filter(|h| h.iter().all(u8::is_ascii_hexdigit))?;
            let hex = std::str::from_utf8(hex).ok()?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    let decoded = String::from_utf8(out).ok()?;
    Some(decoded.into())
}

#[cfg(test)]
mod tests {
    use super::file_path;
    use std::path::PathBuf;

    #[test]
    fn decodes_a_portal_uri() {
        assert_eq!(
            file_path("file:///home/ana/Pictures/Screenshot%20from%202026-11-10.png"),
            Some(PathBuf::from("/home/ana/Pictures/Screenshot from 2026-11-10.png"))
        );
        assert_eq!(file_path("file://localhost/tmp/a.png"), Some(PathBuf::from("/tmp/a.png")));
    }

    #[test]
    fn refuses_what_isnt_a_local_file() {
        assert_eq!(file_path("https://example.com/a.png"), None);
        assert_eq!(file_path("file://otherhost/tmp/a.png"), None);
        assert_eq!(file_path("file:///tmp/bad%zz.png"), None);
        assert_eq!(file_path("file:///tmp/cut%2"), None);
    }
}
