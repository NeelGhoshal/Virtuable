// Classic worker: keeps OpenCV off the page's main thread.
importScripts('/vendor/opencv.js', '/pipeline.js');

const CASCADES = ['haarcascade_frontalface_default.xml', 'haarcascade_hand_detection.xml'];
let pipeline;
let frame = 0;

async function start() {
  const cv = self.cv instanceof Promise ? await self.cv : self.cv;
  if (!cv.Mat) await new Promise((resolve) => (cv.onRuntimeInitialized = resolve));
  const [face, hand] = await Promise.all(
    CASCADES.map(async (name) => {
      const res = await fetch('/cascades/' + name);
      if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
      cv.FS_createDataFile('/', name, new Uint8Array(await res.arrayBuffer()), true, false, false);
      const cascade = new cv.CascadeClassifier();
      if (!cascade.load(name)) throw new Error(`${name} could not be loaded`);
      return cascade;
    }),
  );
  pipeline = self.VirtuablePipeline.createPipeline(cv, face, hand);
  postMessage({ type: 'ready' });
}

onmessage = ({ data }) => {
  if (!pipeline) return;
  try {
    if (data.type === 'frame') {
      const result = pipeline.analyse(data.image, frame++ % 4 === 0);
      postMessage({ type: 'result', ...result });
    } else if (data.type === 'calibrate') {
      pipeline.calibrate(data.image);
      postMessage({ type: 'calibrated' });
    } else if (data.type === 'reset') {
      pipeline.resetSkin();
    }
  } catch (err) {
    postMessage({ type: 'frame-error', message: String(err && err.message ? err.message : err) });
  }
};

start().catch((err) => postMessage({ type: 'load-error', message: String(err.message || err) }));
