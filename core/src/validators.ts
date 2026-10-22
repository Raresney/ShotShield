// Checksum validators used by the detector table to cut false positives.
// Each takes the raw string and returns whether the checksum holds up.

/** Luhn (mod 10) — credit cards and a few other numbers. */
export function luhn(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

/** IBAN mod-97 checksum (ISO 13616). Expects the IBAN with spaces removed. */
export function ibanValid(iban: string): boolean {
  const s = iban.toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s)) return false;
  // Move the first four chars to the end, then reduce the whole thing mod 97
  // digit by digit (letters expand to two digits: A=10 … Z=35).
  const rearranged = s.slice(4) + s.slice(0, 4);
  let rem = 0;
  for (let i = 0; i < rearranged.length; i++) {
    const c = rearranged.charCodeAt(i);
    const v = c >= 65 ? c - 55 : c - 48;
    rem = v > 9 ? (rem * 100 + v) % 97 : (rem * 10 + v) % 97;
  }
  return rem === 1;
}

/**
 * Romanian CUI/CIF fiscal code: 2–10 digits (an optional RO prefix is ignored),
 * last digit is the control. Weights are the 753217532 key, right-aligned to the
 * body; sum × 10 mod 11, with 10 folding to 0.
 */
export function cuiValid(cui: string): boolean {
  const s = cui.replace(/^RO/i, "");
  if (!/^\d{2,10}$/.test(s)) return false;
  const key = [7, 5, 3, 2, 1, 7, 5, 3, 2];
  const body = s.slice(0, -1);
  const control = s.charCodeAt(s.length - 1) - 48;
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    // Align the body's rightmost digit with the key's rightmost weight.
    sum += (body.charCodeAt(body.length - 1 - i) - 48) * key[key.length - 1 - i]!;
  }
  let c = (sum * 10) % 11;
  if (c === 10) c = 0;
  return c === control;
}

/** Romanian CNP control digit: 13 digits, weighted sum mod 11. */
export function cnpValid(cnp: string): boolean {
  if (!/^\d{13}$/.test(cnp)) return false;
  const weights = [2, 7, 9, 1, 4, 6, 3, 5, 8, 2, 7, 9];
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += (cnp.charCodeAt(i) - 48) * weights[i]!;
  let control = sum % 11;
  if (control === 10) control = 1;
  return control === cnp.charCodeAt(12) - 48;
}

const BECH32_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const BECH32_GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

/**
 * Bech32 / bech32m checksum (BIP-173, BIP-350) — native SegWit and Taproot
 * Bitcoin addresses. Mixed case is invalid by spec.
 */
export function bech32Valid(addr: string): boolean {
  if (addr !== addr.toLowerCase() && addr !== addr.toUpperCase()) return false;
  const s = addr.toLowerCase();
  const sep = s.lastIndexOf("1");
  if (sep < 1 || sep + 7 > s.length || s.length > 90) return false;
  const values: number[] = [];
  for (const c of s.slice(0, sep)) values.push(c.charCodeAt(0) >> 5);
  values.push(0);
  for (const c of s.slice(0, sep)) values.push(c.charCodeAt(0) & 31);
  for (const c of s.slice(sep + 1)) {
    const v = BECH32_CHARSET.indexOf(c);
    if (v < 0) return false;
    values.push(v);
  }
  let chk = 1;
  for (const v of values) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= BECH32_GEN[i]!;
  }
  return chk === 1 || chk === 0x2bc830a3;
}

/**
 * A public, routable IPv4 address. Private, loopback, link-local, CGNAT,
 * multicast and reserved ranges are rejected — they reveal nothing about who
 * took the screenshot and would flood a dev screenshot with noise.
 */
export function publicIpv4(ip: string): boolean {
  const parts = ip.split(".");
  if (parts.length !== 4) return false;
  const o = parts.map((p) => (/^(0|[1-9]\d{0,2})$/.test(p) ? +p : -1));
  if (o.some((n) => n < 0 || n > 255)) return false;
  const [a, b] = o as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  return true;
}
