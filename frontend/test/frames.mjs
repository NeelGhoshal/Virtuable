// Synthetic 640x480 camera frames: a hand drawn inside the detection box, on blue-grey.
const W = 640;
const H = 480;

export function blank(color = [60, 90, 140]) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < data.length; i += 4) data.set([...color, 255], i);
  return { width: W, height: H, data };
}

function segDist(px, py, ax, ay, bx, by) {
  const len = (bx - ax) ** 2 + (by - ay) ** 2;
  const t = Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / len));
  return Math.hypot(px - ax - t * (bx - ax), py - ay - t * (by - ay));
}

export function hand(fingers, color = [224, 172, 130]) {
  const img = blank();
  const cx = 100;
  const cy = 135; // box coordinates, mirrored view
  const step = 32;
  const first = -90 - ((fingers - 1) * step) / 2;
  const tips = Array.from({ length: fingers }, (_, i) => {
    const a = ((first + i * step) * Math.PI) / 180;
    return [cx + Math.cos(a) * 112, cy + Math.sin(a) * 112];
  });
  for (let y = 0; y < 200; y++) {
    for (let x = 0; x < 200; x++) {
      const inside =
        Math.hypot(x - cx, y - cy) < 36 ||
        tips.some(([tx, ty]) => segDist(x, y, cx, cy, tx, ty) < 8);
      if (!inside) continue;
      const px = W - 1 - (100 + x); // un-mirror
      img.data.set([...color, 255], ((100 + y) * W + px) * 4);
    }
  }
  return img;
}
