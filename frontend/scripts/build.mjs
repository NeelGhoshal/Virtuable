// Assemble dist/: source files, OpenCV, fonts, and the repo's own cascade files.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const at = (p) => fileURLToPath(new URL('../' + p, import.meta.url));
fs.rmSync(at('dist'), { recursive: true, force: true });
fs.cpSync(at('src'), at('dist'), { recursive: true });
fs.cpSync(at('node_modules/@techstark/opencv-js/dist/opencv.js'), at('dist/vendor/opencv.js'));
for (const w of [400, 700, 800]) {
  fs.cpSync(
    at(`node_modules/@fontsource/atkinson-hyperlegible-next/files/atkinson-hyperlegible-next-latin-${w}-normal.woff2`),
    at(`dist/fonts/${w}.woff2`),
  );
}
for (const name of ['haarcascade_frontalface_default.xml', 'haarcascade_hand_detection.xml']) {
  fs.cpSync(at('../opencv_haarcascade_data/' + name), at('dist/cascades/' + name));
}
console.log('Built dist/');
