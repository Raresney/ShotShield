<div align="center">

<img src="docs/logo.png" alt="ShotShield logo" width="120" />

# ShotShield

Find sensitive data in a screenshot and cover it before you share the image. Runs on your machine, and nothing is uploaded.

[![License](https://img.shields.io/badge/license-proprietary-red)](LICENSE)
[![Latest release](https://img.shields.io/github/v/release/Raresney/ShotShield?sort=semver)](https://github.com/Raresney/ShotShield/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/Raresney/ShotShield/total)](https://github.com/Raresney/ShotShield/releases)
![Built with Tauri](https://img.shields.io/badge/built%20with-Tauri-24C8DB?logo=tauri&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)

<picture>
  <source media="(prefers-color-scheme: light)" srcset="docs/screenshot-light.png" />
  <img src="docs/screenshot.png" alt="ShotShield with a scanned .env screenshot: keys, a database URL, an email, a phone number and an IBAN covered, the findings listed on the right" width="900" />
</picture>

</div>

You paste a screenshot into a chat or an issue, and only later notice it had an API key in the corner, or an IBAN, or your own face. ShotShield scans the picture locally, marks what it finds, and lets you paint over it. The redaction is baked into the file you export, not just drawn on top for show.

## What it catches

The engine reads the text in an image with OCR, then runs it through a table of matchers. Most of them lean on a checksum or a printed label, so they stay quiet on random digits:

- API keys and tokens: Anthropic, OpenAI, GitHub (classic and fine-grained), GitLab, npm, Hugging Face, AWS, Google (API keys and OAuth tokens), Stripe (secret keys and webhook secrets), Slack and Discord webhooks, Telegram bots, Shopify, DigitalOcean, Twilio, SendGrid, plus PEM private-key blocks
- Passwords and secrets behind a name (`DB_PASSWORD=…`, `"client_secret": "…"`), `Authorization: Bearer|Basic` headers, and logins embedded in URLs (`postgres://user:pass@host`)
- JSON Web Tokens
- Payment cards, checked with Luhn and named by brand (Visa, Mastercard, Amex, Discover)
- IBANs (mod-97) and SWIFT/BIC codes
- CVV codes, when they sit right next to their label
- Romanian CNP and CUI/CIF, each confirmed by its control digit
- Romanian ID cards: the printed "SERIA … NR …" line and the machine-readable zone along the bottom
- People's names behind a label: the ID card's Nume/Nom/Last name, or a form's `Name:`, `Cardholder:`, `Titular cont:`, `Beneficiar:` and the like
- Emails, and phone numbers in international or Romanian form
- Bitcoin (checksum-verified) and Ethereum wallet addresses
- Public IP addresses — listed, but left visible unless you cover them
- Faces, from a small detector that runs inside the app

The OCR reads English and Romanian; both models are bundled, nothing is downloaded. The matchers expect OCR to slip — an underscore read as a space in the middle of a key, a monospace zero read as `@` or `O` — and still catch the value. Sideways photos get straightened automatically before the scan. And when an image reads like a Romanian ID but no CNP turned up, the scan takes a second look at a different scale — on a phone photo the number is usually there, just read badly the first time around.

Every category has an on/off switch in the Detection drawer, a slider sets the minimum confidence a finding needs to show up, and you can add your own regex rules on top.

## Using it

Drop a screenshot anywhere on the window — or a whole batch of them — paste one with `Ctrl+V`, or pick files. On Windows you can skip the screenshot step entirely: press `Ctrl+Alt+R` from any app (or the capture button), drag over the part of the screen you want, and it lands in ShotShield already scanned. The capture never touches the disk. The scan runs — a status pill over the image names each stage — and anything sensitive is covered right away, with the findings listed worst first. Click a finding — in the list or right on the image — to uncover or re-cover it, click a severity count to show only that severity, drag a box on the image to hide something the scan missed, like a home address (drag the box again to move it, or its edges to resize it), and hold the compare button to peek at the original.

Covered areas are solid black by default; the Detection drawer switches them to a mosaic. The mosaic is generated rather than averaged from the pixels underneath, so unlike ordinary pixelation it can't be reversed by guessing the text. **Save image** opens the system Save As dialog and writes the redacted copy, boxes baked into the pixels; **Copy** puts it on the clipboard for the chat you were about to paste it into. With several images open, they scan one after another in the background while you review the first; a strip of thumbnails shows which still have something exposed, `←` / `→` steps through them, and **Save all** writes every redacted copy into a folder you pick once.

Switch to **Text** mode for logs, `.env` files and messages: findings show up as you type, and **Copy redacted text** gives you the same text with every finding replaced by `[REDACTED]`.

A few keys speed up the loop:

- `Space` covers or uncovers every finding at once
- `Ctrl+Z` and `Ctrl+Y` undo and redo a hand-drawn box
- `Ctrl+S` saves the redacted image, `Ctrl+O` opens one
- `Delete` removes the last box you drew
- `Esc` closes the Detection drawer
- `Ctrl`+wheel or `+` / `-` zooms toward the cursor, the wheel or a middle-drag pans, `0` fits the image again

## Privacy

The image stays on your computer. The OCR (tesseract.js), the face model (face-api) and even the fonts are bundled into the app and run offline, so there's no account to create and nowhere for the picture to be sent. The build also ships a Content Security Policy that blocks outbound requests, which stops a stray dependency from phoning home. Saving goes through the system dialog, and the app can only write the one file you pick there.

The export helps too, in a quieter way: the file you save is redrawn from the canvas, pixel by pixel, so camera metadata — EXIF tags, GPS coordinates, device model — never makes it into the copy you share. And because the redaction is painted into those pixels rather than layered on top, there's nothing underneath to recover.

## What's in the repo

It's an npm workspace with two halves.

`core/` is the detection engine: plain TypeScript, no runtime dependencies, with its own test suite. Hand it text and it gives back the spans it thinks are sensitive. None of it is tied to the desktop app, so it can be reused on its own.

`desktop/` is the app, built on Tauri v2 (a Rust shell around the system WebView) with a Vite and TypeScript front end. It does the OCR, the face pass, the canvas redaction and the export. A phone version is the long-term plan, not something that ships today.

## Install

Grab the latest build for your platform from the [releases page](https://github.com/Raresney/ShotShield/releases/latest). Windows ships an `.exe` and an `.msi`; Linux ships an AppImage, a `.deb` and an `.rpm`. Run it and you're set. The build isn't code-signed yet, so Windows SmartScreen may warn you on first launch. Click "More info" then "Run anyway". The app checks for updates on its own and can install them in place.

## Build from source

You'll need a recent Node (22+) and the Tauri prerequisites for your platform: a Rust toolchain, plus the WebView2 runtime on Windows.

```sh
npm install
npm run tauri dev
```

That compiles the core, starts Vite and opens the window. `npm run tauri build` produces a release binary, and `npm test -w core` runs the engine's tests.

## Status

The core is the dependable part: every detector above is in place and tested. The desktop app already works front to back. You drop an image, look over what was flagged, and save a redacted copy. It's where most of the day-to-day work happens right now, so expect the odd rough edge.

## License

Proprietary. Copyright (c) 2026 Rareș (@Raresney). All rights reserved.

The source is public so you can read it, but it is not open-source: see the [LICENSE](LICENSE). No use, copying, modification, or distribution is permitted without prior written permission. Bundled third-party components keep their own licenses.
