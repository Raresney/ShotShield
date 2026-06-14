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
