import assert from "node:assert/strict";
import { test } from "node:test";
import { checkEmail, detectPattern, emailKind, guessEmail, patternOf, validSyntax } from "../../server/email.js";

test("role inboxes versus personal addresses", () => {
  for (const role of [
    "info@firma.de", "kontakt@firma.de", "sales@acme.com", "info-berlin@firma.de", "support.de@acme.com", "no-reply@acme.com",
    "bewerbung@firma.de", "datenschutz@firma.de", "hello+web@acme.com", "berlin@kanzlei.de", "solutions@acme.com", "jo@acme.com",
  ]) assert.equal(emailKind(role), "role", role);
  for (const personal of ["max.mustermann@firma.de", "m.mustermann@firma.de", "jane_doe@acme.com", "anna-lena.schmidt@firma.de"]) {
    assert.equal(emailKind(personal), "personal", personal);
  }
});

test("a single-word address is personal only when it matches someone named on the site", () => {
  assert.equal(emailKind("jason@basecamp.com"), "role");
  assert.equal(emailKind("jason@basecamp.com", ["Jason Fried"]), "personal");
  assert.equal(emailKind("jfried@basecamp.com", ["Jason Fried"]), "personal");
  assert.equal(emailKind("mueller@firma.de", ["Jörg Müller"]), "personal");
  assert.equal(emailKind("info@firma.de", ["Ina Info"]), "role"); // a role word stays a role inbox
});

test("syntax check", () => {
  for (const ok of ["a@b.de", "first.last+tag@sub.domain.co.uk", "x_y%z@a-b.io"]) assert.equal(validSyntax(ok), true, ok);
  for (const bad of ["", "plain", "@b.de", "a@b", "a@@b.de", "a b@c.de", ".a@b.de", "a..b@c.de", "a@-b.de", "a@b..de", "a".repeat(65) + "@b.de"]) {
    assert.equal(validSyntax(bad), false, bad);
  }
});

test("checkEmail flags bad syntax without any lookup", async () => {
  assert.deepEqual(await checkEmail("  Not-An-Email ", null), {
    email: "not-an-email", kind: "role", source_url: null, status: "invalid", reason: "not a valid email address",
  });
});

test("address patterns: detection from a published address and guessing", () => {
  assert.equal(patternOf("Max Mustermann", "max.mustermann"), "first.last");
  assert.equal(patternOf("Max Mustermann", "mmustermann"), "flast");
  assert.equal(patternOf("Max Mustermann", "m.mustermann"), "f.last");
  assert.equal(patternOf("Max Mustermann", "max"), "first");
  assert.equal(patternOf("Max Mustermann", "office"), undefined);
  assert.equal(patternOf("Cher", "cher"), undefined); // one-word names give no pattern

  assert.deepEqual(detectPattern(["Erika Musterfrau", "Max Mustermann"], ["mmustermann@firma.de"], "firma.de"), { pattern: "flast", example: "mmustermann@firma.de" });
  assert.equal(detectPattern(["Max Mustermann"], ["mmustermann@other.de"], "firma.de"), null); // another domain proves nothing
  assert.equal(detectPattern(["Max Mustermann"], ["info@firma.de"], "firma.de"), null);

  assert.equal(guessEmail("Erika Musterfrau", "firma.de", "flast"), "emusterfrau@firma.de");
  assert.equal(guessEmail("Jörg Müller-Weiß", "firma.de"), "joerg.muellerweiss@firma.de");
  assert.equal(guessEmail("José Peña", "acme.com"), "jose.pena@acme.com");
  assert.equal(guessEmail("Erika von Musterfrau", "firma.de"), "erika.musterfrau@firma.de");
  assert.equal(guessEmail("Cher", "acme.com"), null);
});
