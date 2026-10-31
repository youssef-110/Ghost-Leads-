import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const landing = readFileSync(new URL('../src/Landing.tsx', import.meta.url), 'utf8');
const preview = readFileSync(new URL('../src/Preview.tsx', import.meta.url), 'utf8');

test('public copy does not present local references as verified Needle queue state', () => {
  for (const page of [landing, preview]) {
    assert.match(page, /23 local draft references/i);
    assert.doesNotMatch(page, /23 (?:personalized )?notes? (?:were )?drafted and queued/i);
  }
  assert.match(landing, /remote queue state is not independently verified/i);
  assert.match(preview, /remote queue status is unverified/i);
  assert.match(preview, /22 involve AI Ark-unchecked rows/i);
});

test('illustrative preview is explicitly labeled, not presented as recorded lead data', () => {
  assert.match(landing, /Illustrative example · not a real lead/);
  assert.match(landing, /Illustrative review UI/);
});
