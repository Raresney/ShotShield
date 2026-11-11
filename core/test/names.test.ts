import { test } from "node:test";
import assert from "node:assert/strict";
import { scan } from "../src/index.ts";

// Made-up people throughout; the names are common ones, not anyone in particular.
const names = (text: string) => scan(text).filter((d) => d.category === "name").map((d) => d.text);

test("a given name beside a family name, in either order", () => {
  assert.deepEqual(names("Thanks, Ana Popescu"), ["Ana Popescu"]);
  assert.deepEqual(names("John Smith replied to your comment"), ["John Smith"]);
  assert.deepEqual(names("Raport semnat de Popescu Andrei ieri"), ["Popescu Andrei"]);
  assert.deepEqual(names("Sarah Connor joined the call"), ["Sarah Connor"]);
});

test("capitals, diacritics, hyphens and three-word names", () => {
  assert.deepEqual(names("ION IONESCU"), ["ION IONESCU"]);
  assert.deepEqual(names("Ștefan Dumitrescu a scris"), ["Ștefan Dumitrescu"]);
  assert.deepEqual(names("cc Maria-Elena Dumitrescu"), ["Maria-Elena Dumitrescu"]);
  assert.deepEqual(names("Ana Maria Popescu"), ["Ana Maria Popescu"]);
});

test("a Romanian family name the list lacks is known by its ending", () => {
  assert.deepEqual(names("Mesaj de la Mihaela Bădescu"), ["Mihaela Bădescu"]);
  assert.deepEqual(names("Cosmin Ardeleanu"), ["Cosmin Ardeleanu"]);
});

test("a capital I misread as l still makes the name", () => {
  assert.deepEqual(names("lon Popescu"), ["lon Popescu"]);
});

test("a word the lists don't know in front of a name stays out of it", () => {
  assert.deepEqual(names("Copyright Michael Ciniawsky"), ["Michael Ciniawsky"]);
  assert.deepEqual(names("Font: \"John Doe\" by default"), []);
});

test("a name is two words on one line, not a lone given name", () => {
  assert.deepEqual(names("Hi Daniel, see you tomorrow"), []);
  assert.deepEqual(names("Ana\nPopescu"), []);
  assert.deepEqual(names("Ana, Popescu"), []);
});

test("given names that are also words need a real family name", () => {
  assert.deepEqual(names("May Update is out"), []);
  assert.deepEqual(names("Grace Period ends Friday"), []);
  assert.deepEqual(names("Jordan Shoes sale"), []);
  assert.deepEqual(names("Will Smith"), ["Will Smith"]);
});

test("title-case words around a given name don't make it a name", () => {
  assert.deepEqual(names("Font: Victor Mono"), []);
  assert.deepEqual(names("Sign In With Google"), []);
  assert.deepEqual(names("Hello Daniel"), []);
  assert.deepEqual(names("Daniel BCR"), []);
});

test("places named after someone are left alone", () => {
  assert.deepEqual(names("Strada Ion Creangă"), []);
  assert.deepEqual(names("Liceul Mihai Eminescu"), []);
  assert.deepEqual(names("near Victoria Station"), []);
  assert.deepEqual(names("Spitalul Elias"), []);
});

test("an unlabelled name ranks below a labelled one and can be switched off", () => {
  const [det] = scan("Hello from Ana Popescu");
  assert.equal(det?.severity, "medium");
  assert.ok((det?.confidence ?? 1) < 0.9);
  assert.deepEqual(scan("Hello from Ana Popescu", { enabled: { name: false } }), []);
  assert.deepEqual(scan("Hello from Ana Popescu", { minConfidence: 0.9 }), []);
  assert.deepEqual(scan("Hello from Ana Popescu", { allow: ["ana popescu"] }), []);
});

test("a labelled name keeps its label's rating", () => {
  const dets = scan("Name: Ana Popescu");
  assert.equal(dets.length, 1);
  assert.equal(dets[0]?.severity, "high");
});
