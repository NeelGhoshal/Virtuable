import test from 'node:test';
import assert from 'node:assert/strict';
import { createStabilizer } from '../src/stabilizer.js';
import { parseSpeech } from '../src/commands.js';

const run = (frames) => {
  const step = createStabilizer();
  return frames.map(([t, label]) => step(label, t).fire).filter(Boolean);
};
const hold = (label, from, to) => {
  const out = [];
  for (let t = from; t <= to; t += 100) out.push([t, label]);
  return out;
};

test('fires once while held', () => {
  assert.deepEqual(run(hold('mute', 0, 3000)), ['mute']);
});
test('ignores a brief gesture', () => {
  assert.deepEqual(run([...hold('mute', 0, 600), ...hold('none', 700, 2000)]), []);
});
test('one bad frame does not restart the hold', () => {
  assert.deepEqual(run([...hold('mute', 0, 400), [500, 'none'], ...hold('mute', 600, 1000)]), ['mute']);
});
test('fires again after release', () => {
  const frames = [...hold('agree', 0, 1000), ...hold('none', 1100, 1800), ...hold('agree', 1900, 3000)];
  assert.deepEqual(run(frames), ['agree', 'agree']);
});
test('switching gesture fires the new one', () => {
  assert.deepEqual(run([...hold('mute', 0, 1000), ...hold('unmute', 1100, 3000)]), ['mute', 'unmute']);
});

test('speech is a command or a message', () => {
  assert.deepEqual(parseSpeech('Mute.'), { command: 'mute' });
  assert.deepEqual(parseSpeech('un mute'), { command: 'unmute' });
  assert.deepEqual(parseSpeech('Raise my hand'), { command: 'raise' });
  assert.deepEqual(parseSpeech('lower hand'), { command: 'lower' });
  assert.deepEqual(parseSpeech('Please mute the video first'), { message: 'Please mute the video first' });
  assert.equal(parseSpeech('  '), null);
});
