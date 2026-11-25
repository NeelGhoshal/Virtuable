import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import '../src/pipeline.js';
import { hand, blank } from './frames.mjs';

const loaded = createRequire(import.meta.url)('@techstark/opencv-js');
const cv = loaded instanceof Promise ? await loaded : loaded;
if (!cv.Mat) await new Promise((resolve) => (cv.onRuntimeInitialized = resolve));

function cascade(name) {
  const file = new URL('../../opencv_haarcascade_data/' + name, import.meta.url);
  cv.FS_createDataFile('/', name, fs.readFileSync(file), true, false, false);
  const c = new cv.CascadeClassifier();
  assert.ok(c.load(name));
  return c;
}
const face = cascade('haarcascade_frontalface_default.xml');
const palm = cascade('haarcascade_hand_detection.xml');
const make = () => globalThis.VirtuablePipeline.createPipeline(cv, face, palm);

for (const [fingers, want] of [[1, 'agree'], [2, 'unmute'], [3, 'mute'], [4, 'four']]) {
  test(`${fingers} fingers: ${want}`, () => {
    assert.equal(make().analyse(hand(fingers)).gesture, want);
  });
}

test('an empty box reads as nothing', () => {
  assert.equal(make().analyse(blank()).gesture, 'none');
});

test('a skin-coloured background is not a fist', () => {
  assert.equal(make().analyse(blank([224, 172, 130])).gesture, 'background');
});

test('calibration picks up a hand the default range misses', () => {
  const dark = hand(2, [60, 42, 36]);
  const p = make();
  assert.equal(p.analyse(dark).gesture, 'none');
  p.calibrate(blank([60, 42, 36])); // a palm covering the middle of the box
  assert.equal(p.analyse(dark).gesture, 'unmute');
  p.resetSkin();
  assert.equal(p.analyse(dark).gesture, 'none');
});

test('calibration handles hues that wrap past red', () => {
  const pink = hand(3, [200, 120, 126]);
  const p = make();
  p.calibrate(pink);
  assert.equal(p.analyse(pink).gesture, 'mute');
});

test('memory stays flat over many frames', () => {
  const p = make();
  const frame = hand(3);
  const before = cv.HEAP8.length;
  for (let i = 0; i < 300; i++) p.analyse(frame, i % 30 === 0);
  assert.ok(cv.HEAP8.length - before < 64e6, `grew ${cv.HEAP8.length - before}`);
});
