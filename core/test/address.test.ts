import { test } from "node:test";
import assert from "node:assert/strict";
import { scan } from "../src/index.ts";

const addresses = (text: string) => scan(text).filter((d) => d.category === "address").map((d) => d.text);

test("Romanian street addresses with their number and flat details", () => {
  assert.deepEqual(addresses("Livrare la Str. Mihai Eminescu nr. 12, bl. A3, sc. 2, ap. 14 pana vineri"), [
    "Str. Mihai Eminescu nr. 12, bl. A3, sc. 2, ap. 14",
  ]);
  assert.deepEqual(addresses("Sediu: Bd. Unirii nr 7A"), ["Bd. Unirii nr 7A"]);
  assert.deepEqual(addresses("Calea Victoriei, nr. 155"), ["Calea Victoriei, nr. 155"]);
});

test("English street addresses", () => {
  assert.deepEqual(addresses("Ship to 221 Baker Street, London"), ["221 Baker Street"]);
  assert.deepEqual(addresses("Office at 1600 Pennsylvania Ave. today"), ["1600 Pennsylvania Ave."]);
});

test("the line after an address label", () => {
  assert.deepEqual(addresses("Domiciliu: Mun. Cluj-Napoca, Jud. Cluj\nEmis de: SPCLEP"), ["Mun. Cluj-Napoca, Jud. Cluj"]);
  assert.deepEqual(addresses("Home address: 4 Rue de Rivoli, Paris"), ["4 Rue de Rivoli, Paris"]);
});

test("prose and other fields stay clean", () => {
  assert.deepEqual(addresses("Strada e lunga si frumoasa."), []);
  assert.deepEqual(addresses("We walked 3 blocks down the road"), []);
  // An email or one bare word after the label isn't an address.
  assert.deepEqual(addresses("Address: ana@example.com"), []);
  assert.deepEqual(addresses("IP Address: unknown"), []);
});

test("an IP, email or wallet address label isn't a postal address", () => {
  assert.deepEqual(addresses("IP address: 192.168.0.1 (router)"), []);
  assert.deepEqual(addresses("Email Address: ana at example dot com"), []);
  assert.deepEqual(addresses("Wallet address: see below please"), []);
});
