# Roadmap

Rough order, not dates. Built in the open, so this will move around.

### Done
- [x] Detection core: API keys and tokens, credentials, JWT, cards (Luhn), IBAN (mod-97), SWIFT/BIC, CNP and CUI with their control digits, ID machine-readable zones, passports, licences, plates, names, addresses, wallets, IPs
- [x] Desktop app on Windows, macOS and Linux: OCR, face detection, black or mosaic covers, batch mode, PDF in and out, signed auto-updates
- [x] Screen capture with `Ctrl+Alt+R`, tray and start-at-login on Windows
- [x] Romanian IDs read off a phone photo, CNP included

### Next
- [ ] Sharper OCR on hard photos, and a way to use the system's own OCR where there is one
- [ ] Screen capture on macOS and Linux
- [ ] Addresses boxed line by line instead of by label
- [ ] Authenticode-signed Windows installers (see [SIGNING](.github/SIGNING.md))

### Later
- [ ] Phone app with a share-sheet entry point ("Share to ShotShield")
- [ ] QR codes and barcodes that carry personal data
