# ShotShield desktop

The Tauri v2 app around [`@shotshield/core`](../core), with a Vite and vanilla TypeScript front end. It runs the OCR and the face pass, draws the covers on a canvas and writes the redacted image or PDF.

## Develop

From the repo root:

```sh
npm install
npm run tauri dev --workspace desktop
```

You need the [Tauri prerequisites](https://tauri.app/start/prerequisites/): Rust and a C/C++ toolchain. WebView2 already ships with Windows.
