# ShotShield

Find sensitive data in a screenshot and cover it before you share the image. It all runs on your machine. Nothing is uploaded.

You paste a screenshot into a chat or an issue, and only later notice it had an API key in the corner, or an IBAN, or your own face. ShotShield scans the picture locally, marks what it finds, and lets you paint over it. The redaction is baked into the file you export, not just drawn on top for show.

## What it catches

The engine reads the text in an image with OCR, then runs it through a table of matchers. Most of them lean on a checksum or a printed label, so they stay quiet on random digits:

- API keys and secrets: GitHub, OpenAI, AWS, Google, Slack, Stripe and SendGrid tokens, plus PEM private-key blocks
- JSON Web Tokens
- Payment cards, checked with Luhn and named by brand (Visa, Mastercard, Amex, Discover)
- IBANs (mod-97) and SWIFT/BIC codes
- CVV codes, when they sit right next to their label
- Romanian CNP and CUI/CIF, each confirmed by its control digit
- Romanian ID cards: the printed "SERIA … NR …" line and the machine-readable zone along the bottom
- The holder's name, when it trails a Nume/Nom/Last name label
- Emails, and phone numbers in international or Romanian form
- Faces, from a small detector that runs inside the app

Every category has an on/off switch, and you can add your own regex rules on top.

## Privacy

The image stays on your computer. The OCR (tesseract.js) and the face model (face-api) are bundled into the app and run offline, so there's no account to create and nowhere for the picture to be sent. The build also ships a Content Security Policy that blocks outbound requests, which stops a stray dependency from phoning home.

## What's in the repo

It's an npm workspace with two halves.

`core/` is the detection engine: plain TypeScript, no runtime dependencies, with its own test suite. Hand it text and it gives back the spans it thinks are sensitive. None of it is tied to the desktop app, so it can be reused on its own.

`desktop/` is the app, built on Tauri v2 (a Rust shell around the system WebView) with a Vite and TypeScript front end. It does the OCR, the face pass, the canvas redaction and the export. A phone version is the long-term plan, not something that ships today.

## Running it

You'll need a recent Node (22+) and the Tauri prerequisites for your platform: a Rust toolchain, plus the WebView2 runtime on Windows.

```sh
npm install
npm run tauri dev
```

That compiles the core, starts Vite and opens the window. `npm run tauri build` produces a release binary, and `npm test -w core` runs the engine's tests.

## Status

The core is the dependable part: every detector above is in place and tested. The desktop app already works front to back. You drop an image, look over what was flagged, and save a redacted copy. It's where most of the day-to-day work happens right now, so expect the odd rough edge.

## License

MIT. See [LICENSE](LICENSE).
