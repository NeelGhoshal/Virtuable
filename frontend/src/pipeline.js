// Browser port of VideoCamera.render_features in stream/camera.py.
// Plain script (no exports) so it loads in a classic worker and in Node tests.
(function (root) {
  const ROI = { x: 100, y: 100, size: 200 };
  const MIN_HAND_AREA = 2000;
  // Not in camera.py: a blob filling the box is a skin-coloured background, not a fist.
  const MAX_FILL = 0.85;
  const DEFAULT_SKIN = [{ lower: [0, 20, 70], upper: [20, 255, 255] }];

  function createPipeline(cv, faceCascade, handCascade) {
    let skin = DEFAULT_SKIN;
    let seen = { faces: [], palms: [] };

    const centreIn = (a, b) => {
      const x = a.x + a.width / 2;
      const y = a.y + a.height / 2;
      return x > b.x && x < b.x + b.width && y > b.y && y < b.y + b.height;
    };

    // The box is defined on the mirrored frame, as in camera.py.
    function boxHsv(rgba) {
      const flipped = new cv.Mat();
      const rgb = new cv.Mat();
      const hsv = new cv.Mat();
      const view = rgba.roi(new cv.Rect(rgba.cols - ROI.x - ROI.size, ROI.y, ROI.size, ROI.size));
      cv.flip(view, flipped, 1);
      cv.cvtColor(flipped, rgb, cv.COLOR_RGBA2RGB);
      cv.cvtColor(rgb, hsv, cv.COLOR_RGB2HSV);
      view.delete();
      flipped.delete();
      rgb.delete();
      return hsv;
    }

    function skinMask(hsv) {
      const mask = cv.Mat.zeros(hsv.rows, hsv.cols, cv.CV_8UC1);
      for (const { lower, upper } of skin) {
        const lo = new cv.Mat(hsv.rows, hsv.cols, hsv.type(), [...lower, 0]);
        const hi = new cv.Mat(hsv.rows, hsv.cols, hsv.type(), [...upper, 255]);
        const part = new cv.Mat();
        cv.inRange(hsv, lo, hi, part);
        cv.bitwise_or(mask, part, mask);
        lo.delete();
        hi.delete();
        part.delete();
      }
      const kernel = cv.Mat.ones(3, 3, cv.CV_8U);
      cv.dilate(mask, mask, kernel, new cv.Point(-1, -1), 4);
      cv.GaussianBlur(mask, mask, new cv.Size(5, 5), 100);
      kernel.delete();
      return mask;
    }

    // count is 1 + the number of gaps between fingers; 0 means unreadable.
    function readFingers(mask) {
      const contours = new cv.MatVector();
      const hierarchy = new cv.Mat();
      const approx = new cv.Mat();
      const hull = new cv.Mat();
      const defects = new cv.Mat();
      let cnt = null;
      try {
        cv.findContours(mask, contours, hierarchy, cv.RETR_TREE, cv.CHAIN_APPROX_SIMPLE);
        let area = -1;
        for (let i = 0; i < contours.size(); i++) {
          const c = contours.get(i);
          const a = cv.contourArea(c);
          if (a > area) {
            if (cnt) cnt.delete();
            cnt = c;
            area = a;
          } else {
            c.delete();
          }
        }
        if (!cnt) return null;
        cv.approxPolyDP(cnt, approx, 0.0005 * cv.arcLength(cnt, true), true);
        const pts = approx.data32S;
        const at = (i) => [pts[i * 2], pts[i * 2 + 1]];
        const outline = Array.from({ length: approx.rows }, (_, i) => at(i));
        const fill = area / (ROI.size * ROI.size);
        if (approx.rows < 4) return { area, fill, count: 0, outline, gaps: [] };
        cv.convexHull(approx, hull, false, false);
        cv.convexityDefects(approx, hull, defects);
        // A perfectly convex blob: camera.py throws here and reports nothing.
        if (!defects.rows) return { area, fill, count: 0, outline, gaps: [] };
        const gaps = [];
        for (let i = 0; i < defects.rows; i++) {
          const start = at(defects.data32S[i * 4]);
          const end = at(defects.data32S[i * 4 + 1]);
          const far = at(defects.data32S[i * 4 + 2]);
          const a = Math.hypot(end[0] - start[0], end[1] - start[1]);
          const b = Math.hypot(far[0] - start[0], far[1] - start[1]);
          const c = Math.hypot(end[0] - far[0], end[1] - far[1]);
          const p = (a + b + c) / 2;
          const d = (2 * Math.sqrt(p * (p - a) * (p - b) * (p - c))) / a;
          const angle = Math.acos((b * b + c * c - a * a) / (2 * b * c)) * 57;
          if (angle <= 90 && d > 30) gaps.push(far);
        }
        return { area, fill, count: gaps.length + 1, outline, gaps };
      } finally {
        if (cnt) cnt.delete();
        for (const m of [contours, hierarchy, approx, hull, defects]) m.delete();
      }
    }

    function cascades(rgba) {
      const gray = new cv.Mat();
      const found = new cv.RectVector();
      cv.cvtColor(rgba, gray, cv.COLOR_RGBA2GRAY);
      const rects = () => Array.from({ length: found.size() }, (_, i) => found.get(i));
      faceCascade.detectMultiScale(gray, found, 1.3, 5);
      const faces = rects();
      // camera.py takes any palm from 10px and 3 neighbours, which also fires on faces
      // and clutter. Ask for a larger, better supported palm that is not inside a face.
      handCascade.detectMultiScale(gray, found, 1.1, 6, 0, new cv.Size(60, 60));
      const palms = rects().filter((p) => !faces.some((f) => centreIn(p, f)));
      gray.delete();
      found.delete();
      return { faces, palms };
    }

    function gestureFor(fingers) {
      if (!fingers) return 'none';
      if (fingers.count <= 1 && fingers.fill > MAX_FILL) return 'background';
      if (fingers.count === 1) return fingers.area < MIN_HAND_AREA ? 'none' : 'agree';
      return { 2: 'unmute', 3: 'mute', 4: 'four' }[fingers.count] || 'none';
    }

    return {
      // imageData: unmirrored 640x480 RGBA. Cascades are slow, so callers may skip them.
      analyse(imageData, runCascades = true) {
        const rgba = cv.matFromImageData(imageData);
        if (runCascades) seen = cascades(rgba);
        const hsv = boxHsv(rgba);
        const mask = skinMask(hsv);
        const fingers = readFingers(mask);
        const box = { x: rgba.cols - ROI.x - ROI.size, y: ROI.y, width: ROI.size, height: ROI.size };
        // camera.py lets a palm anywhere block mute and unmute, but fingers in the box often
        // look like a palm to the cascade. Here the box reads fingers; palms count outside it.
        const palm = seen.palms.some((p) => !centreIn(p, box));
        rgba.delete();
        hsv.delete();
        mask.delete();
        return {
          face: seen.faces.length > 0,
          palm,
          gesture: gestureFor(fingers),
          inBox: Boolean(fingers && fingers.area >= MIN_HAND_AREA && fingers.fill <= MAX_FILL),
          outline: fingers ? fingers.outline : [],
          gaps: fingers ? fingers.gaps : [],
        };
      },

      // Not in camera.py: fit the colour range to the hand in the middle of the box.
      calibrate(imageData) {
        const rgba = cv.matFromImageData(imageData);
        const hsv = boxHsv(rgba);
        const ch = [[], [], []];
        for (let y = 85; y < 115; y++)
          for (let x = 85; x < 115; x++)
            for (let k = 0; k < 3; k++) ch[k].push(hsv.data[(y * hsv.cols + x) * 3 + k]);
        rgba.delete();
        hsv.delete();
        const median = (list) => list.sort((a, b) => a - b)[list.length >> 1];
        // Rotate so hues either side of red (179 to 0) sort together.
        const h = (median(ch[0].map((v) => (v + 90) % 180)) + 90) % 180;
        const sv = [Math.max(15, median(ch[1]) - 60), Math.max(25, median(ch[2]) - 80)];
        const lo = h - 12;
        const hi = h + 12;
        const range = (a, b) => ({ lower: [a, ...sv], upper: [b, 255, 255] });
        if (lo < 0) skin = [range(0, hi), range(lo + 180, 179)];
        else if (hi > 179) skin = [range(lo, 179), range(0, hi - 180)];
        else skin = [range(lo, hi)];
        return skin;
      },

      resetSkin() {
        skin = DEFAULT_SKIN;
      },
    };
  }

  root.VirtuablePipeline = { createPipeline, ROI };
})(globalThis);
