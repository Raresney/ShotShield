# Security Policy

## Supported versions

Only the latest release receives fixes. Please reproduce against the
[latest release](https://github.com/Raresney/ShotShield/releases/latest)
before reporting.

## Reporting a vulnerability

Please do not open a public issue for security problems.

Use GitHub's private vulnerability reporting: open the repository's **Security**
tab and click **Report a vulnerability**. That creates a private advisory only
the maintainers can see. Include what you found, how to reproduce it, and the
impact. Expect an initial response within a few days.

## Scope

ShotShield runs fully on-device: OCR, detection and redaction happen locally,
and the production build ships a Content Security Policy that blocks outbound
network requests. Reports that are especially valuable:

- Redaction that can be reversed or bypassed (sensitive data recoverable from an exported image)
- Sensitive data leaving the machine
- Code execution via a crafted image or pasted text
