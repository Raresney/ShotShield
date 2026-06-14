# Roadmap

Rough order, not dates. Built in the open, so this will move around.

### Now — detection core
- [ ] Scanner + first detectors (email, API keys, JWT)
- [ ] Checksum-backed detectors: credit card (Luhn), IBAN (mod-97), CNP
- [ ] Risk summary for a whole image

### Next — desktop
- [ ] Tauri shell with a screenshots-folder watcher
- [ ] OCR (Tesseract) to turn an image into text + regions
- [ ] Review and blur UI

### Later — mobile
- [ ] Share-sheet entry point ("Share to ShotShield")
- [ ] On-device OCR via the platform APIs (ML Kit / Vision)
- [ ] Visual detectors: faces, ID cards, QR codes

The core is useful and testable before any OCR is wired up, so it ships and gets
hardened on its own first.
