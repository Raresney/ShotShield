# Contributing

Thanks for your interest in ShotShield.

## Setup

You need Node 22+ and the Tauri prerequisites for your platform (a Rust
toolchain, and the WebView2 runtime on Windows).

```sh
npm install
npm run tauri dev      # build core, start Vite, open the app
npm test -w core       # run the detection-engine tests
npm run build -w desktop
```

## Workflow

- Branch off `main` and keep each change focused.
- Use Conventional Commits: `feat(core): …`, `fix(desktop): …`, `docs: …`, `chore: …`.
- Add or update tests for anything you change in `core/`.
- Open a pull request; CI runs the tests, the type check and the build.

## Code style

- The `core/` engine has no runtime dependencies — keep it that way.
- Build DOM nodes with `textContent` / `createElement`, never `innerHTML`.
- Keep detectors precise: lean on a checksum or a printed label rather than broad guessing.

## License

By contributing, you agree that your work is licensed under the project's
[AGPL-3.0](LICENSE).
