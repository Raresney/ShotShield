# ShotShield — desktop

Tauri v2 + Vite (vanilla TS) shell around [`@shotshield/core`](../core).

Right now it scans pasted text. Screenshot capture, OCR and the redaction
canvas come next.

## Develop

From the repo root:

```sh
npm install
npm run tauri dev --workspace desktop
```

Needs the [Tauri prerequisites](https://tauri.app/start/prerequisites/) (Rust +
a C/C++ toolchain; WebView2 ships with Windows).
