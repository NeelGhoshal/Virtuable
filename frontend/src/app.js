import { createStabilizer } from './stabilizer.js';
import { parseSpeech } from './commands.js';
import { play, sound, wakeAudio } from './sounds.js';

const $ = (id) => document.getElementById(id);
const video = $('video');
const canvas = $('canvas');
const ctx = canvas.getContext('2d');
const W = canvas.width;
const H = canvas.height;
const ROI = { x: 100, y: 100, size: 200 }; // same box as pipeline.js
const grab = new OffscreenCanvas(W, H).getContext('2d', { willReadFrequently: true });

const state = { mic: false, hand: false, listening: false };

function say(text) {
  // Clear first so a repeated message is announced again.
  $('live').textContent = '';
  setTimeout(() => ($('live').textContent = text), 50);
}
function setStatus(text) {
  $('status').textContent = text;
  say(text);
}

/* ---------- Actions ---------- */

function paint() {
  $('mic').setAttribute('aria-pressed', state.mic);
  $('mic-state').textContent = state.mic ? 'Unmuted' : 'Muted';
  $('hand').setAttribute('aria-pressed', state.hand);
  $('hand-state').textContent = state.hand ? 'Raised' : 'Lowered';
  $('voice').setAttribute('aria-pressed', state.listening);
  $('voice-state').textContent = state.listening ? 'Listening' : 'Not listening';
}

const actions = {
  mute: () => { state.mic = false; return 'Muted'; },
  unmute: () => { state.mic = true; return 'Unmuted'; },
  raise: () => { state.hand = true; return 'Hand raised'; },
  lower: () => { state.hand = false; return 'Hand lowered'; },
  agree: () => { post('I agree'); return 'You agreed'; },
};

function act(name) {
  if (!actions[name]) return;
  const message = actions[name]();
  paint();
  play(name);
  say(message);
  const row = document.querySelector(`[data-gesture="${name}"]`);
  if (row) {
    row.classList.add('fired');
    setTimeout(() => row.classList.remove('fired'), 1200);
  }
}

function post(text) {
  const li = document.createElement('li');
  const time = document.createElement('time');
  time.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  li.append(time, text);
  $('log').append(li);
  $('log').scrollTop = $('log').scrollHeight;
  $('empty').hidden = true;
}

$('mic').onclick = () => act(state.mic ? 'mute' : 'unmute');
$('hand').onclick = () => act(state.hand ? 'lower' : 'raise');
$('voice').onclick = () => toggleVoice();
$('sounds').onchange = (e) => { sound.enabled = e.target.checked; };
$('chat').onsubmit = (e) => {
  e.preventDefault();
  const text = $('text').value.trim();
  if (!text) return;
  post(text);
  say('Message sent');
  $('text').value = '';
};
addEventListener('keydown', (e) => {
  if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.repeat) return;
  const id = { KeyM: 'mic', KeyH: 'hand', KeyV: 'voice' }[e.code];
  if (!id) return;
  e.preventDefault();
  $(id).click();
});

/* ---------- Gesture list ---------- */

const GESTURES = [
  ['unmute', 2, 'Unmute', 'Two fingers in the box'],
  ['mute', 3, 'Mute', 'Three fingers in the box'],
  ['agree', 1, 'I agree', 'One finger or a fist in the box'],
  ['raise', 5, 'Raise hand', 'Open palm, outside the box'],
];
function handSvg(n) {
  const step = 24;
  const fingers = Array.from({ length: n }, (_, i) => {
    const angle = (i - (n - 1) / 2) * step;
    return `<rect x="44" y="8" width="12" height="56" rx="6" transform="rotate(${angle} 50 68)"/>`;
  }).join('');
  return `<svg viewBox="-6 0 112 100" aria-hidden="true">${fingers}<circle cx="50" cy="70" r="22"/></svg>`;
}
for (const [key, n, name, how] of GESTURES) {
  const li = document.createElement('li');
  li.dataset.gesture = key;
  li.innerHTML = `${handSvg(n)}<div><strong>${name}</strong>${how}</div>`;
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Hear sound';
  button.setAttribute('aria-label', `Hear sound: ${name}`);
  button.onclick = () => play(key);
  li.append(button);
  $('gestures').append(li);
}

/* ---------- Camera and detection ---------- */

let worker = null;
let ready = false;
let busy = false;
let stream = null;
let last = null;
let starting = false;
let wasInBox = false;
let frameErrors = 0;
let stepBox = createStabilizer();
let stepPalm = createStabilizer();

const SEEN = {
  none: 'Nothing in the box',
  agree: 'One finger or fist',
  unmute: 'Two fingers',
  mute: 'Three fingers',
  four: 'Four fingers, no action',
  background: 'Background looks like skin',
};

function loadWorker() {
  if (worker) return;
  worker = new Worker('/worker.js');
  worker.onmessage = ({ data }) => {
    if (data.type === 'ready') {
      ready = true;
      $('calibrate').disabled = !stream;
      if (stream) setStatus('Ready. Hold a hand in the box.');
    } else if (data.type === 'result') {
      busy = false;
      frameErrors = 0;
      onResult(data);
    } else if (data.type === 'calibrated') {
      play('done');
      setStatus('Matched to your hand. Gestures should now be picked up.');
    } else if (data.type === 'frame-error') {
      busy = false;
      if (++frameErrors === 10) stopCamera('Gesture detection stopped working. Reload the page to try again.');
    } else if (data.type === 'load-error') {
      loadFailed();
    }
  };
  worker.onerror = loadFailed;
}
function loadFailed() {
  worker?.terminate();
  worker = null;
  ready = false;
  play('error');
  stopCamera('Gesture detection could not load. Check your connection and start the camera again.');
}

async function startCamera() {
  if (starting) return;
  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus('This browser cannot open a camera. Use the buttons, keyboard or chat instead.');
    return;
  }
  starting = true;
  wakeAudio();
  setStatus('Waiting for camera permission.');
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: W }, height: { ideal: H }, facingMode: 'user' },
    });
  } catch (err) {
    play('error');
    setStatus(
      err.name === 'NotAllowedError'
        ? 'Camera access is blocked. Allow it in your browser’s site settings, then start the camera again.'
        : err.name === 'NotFoundError'
          ? 'No camera found. Connect one, then start the camera again.'
          : 'The camera could not open. Close other apps using it, then try again.',
    );
    starting = false;
    return;
  }
  starting = false;
  stream.getVideoTracks()[0].onended = () => stopCamera('The camera was disconnected.');
  video.srcObject = stream;
  await video.play();
  $('camera').textContent = 'Stop camera';
  $('calibrate').disabled = !ready;
  loadWorker();
  setStatus(ready ? 'Ready. Hold a hand in the box.' : 'Camera is on. Loading gesture detection.');
  requestAnimationFrame(tick);
}

function stopCamera(message = 'Camera is off.') {
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  last = null;
  busy = false;
  wasInBox = false;
  stepBox = createStabilizer();
  stepPalm = createStabilizer();
  video.srcObject = null;
  $('camera').textContent = 'Start camera';
  $('calibrate').disabled = true;
  $('seen').textContent = SEEN.none;
  $('meter').style.transform = 'scaleX(0)';
  drawIdle();
  setStatus(message);
}

$('camera').onclick = () => (stream ? stopCamera() : startCamera());

// Centre-crop to 4:3 so phones in portrait are not stretched.
function frameImage() {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const scale = Math.min(vw / W, vh / H);
  const sw = W * scale;
  const sh = H * scale;
  grab.drawImage(video, (vw - sw) / 2, (vh - sh) / 2, sw, sh, 0, 0, W, H);
  return grab.getImageData(0, 0, W, H);
}

function tick() {
  if (!stream) return;
  if (video.readyState >= 2) {
    const image = frameImage();
    draw();
    if (ready && !busy) {
      busy = true;
      worker.postMessage({ type: 'frame', image }, [image.data.buffer]);
    }
  }
  requestAnimationFrame(tick);
}

function onResult(result) {
  if (!stream) return;
  last = result;
  const now = performance.now();
  const box = stepBox(result.gesture in actions ? result.gesture : 'none', now);
  const palm = stepPalm($('palms').checked && result.palm ? 'raise' : 'none', now);

  if (result.inBox && !wasInBox) play('inBox');
  wasInBox = result.inBox;

  // State gestures only act on a change, so holding does not repeat the sound.
  if (box.fire === 'agree') act('agree');
  if (box.fire === 'mute' && state.mic) act('mute');
  if (box.fire === 'unmute' && !state.mic) act('unmute');
  if (palm.fire && !state.hand) act('raise');

  const palmShown = $('palms').checked && result.palm;
  $('seen').textContent = result.gesture === 'none' && palmShown ? 'Open palm'
    : result.gesture === 'none' && result.inBox ? 'Hand in the box' : SEEN[result.gesture];
  $('meter').style.transform = `scaleX(${Math.min(1, Math.max(box.progress, palm.progress))})`;
}

function strokeBox(active) {
  ctx.lineWidth = 12;
  ctx.strokeStyle = '#000';
  ctx.strokeRect(ROI.x, ROI.y, ROI.size, ROI.size);
  ctx.lineWidth = 6;
  ctx.strokeStyle = active ? '#f7c500' : '#fff';
  ctx.strokeRect(ROI.x, ROI.y, ROI.size, ROI.size);
}
function draw() {
  ctx.save();
  ctx.translate(W, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(grab.canvas, 0, 0);
  ctx.restore();
  strokeBox(last?.inBox);
  if (!last?.inBox) return;
  ctx.beginPath();
  last.outline.forEach(([x, y], i) => ctx[i ? 'lineTo' : 'moveTo'](ROI.x + x, ROI.y + y));
  ctx.closePath();
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#f7c500';
  ctx.stroke();
  for (const [x, y] of last.gaps) {
    ctx.beginPath();
    ctx.arc(ROI.x + x, ROI.y + y, 9, 0, 7);
    ctx.fillStyle = '#000';
    ctx.fill();
    ctx.stroke();
  }
}
function drawIdle() {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  strokeBox(false);
  ctx.fillStyle = '#fff';
  ctx.font = '700 26px "Atkinson Hyperlegible Next", Verdana, sans-serif';
  ctx.fillText('Your hand goes here', ROI.x, ROI.y + ROI.size + 48);
}

$('calibrate').onclick = async () => {
  if (!stream || !ready) return;
  $('calibrate').disabled = true;
  setStatus('Cover the middle of the box with your palm. Matching in three seconds.');
  for (let i = 0; i < 3; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    play('tick');
  }
  if (stream && ready) {
    const image = frameImage();
    worker.postMessage({ type: 'calibrate', image }, [image.data.buffer]);
    $('calibrate').disabled = false;
  }
};

/* ---------- Speech ---------- */

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;

function toggleVoice() {
  if (!Recognition) {
    play('error');
    say('This browser has no speech recognition. Type your message instead.');
    $('text').focus();
    return;
  }
  if (recognition) {
    recognition.stop();
    return;
  }
  recognition = new Recognition();
  recognition.lang = navigator.language || 'en-US';
  recognition.interimResults = false;
  recognition.onstart = () => {
    state.listening = true;
    paint();
    play('listen');
  };
  recognition.onresult = (e) => {
    const said = parseSpeech(e.results[0][0].transcript);
    if (!said) return;
    if (said.command) act(said.command);
    else {
      post(said.message);
      say(`Message sent: ${said.message}`);
    }
  };
  recognition.onerror = (e) => {
    if (e.error === 'aborted') return;
    play('error');
    setStatus(
      e.error === 'not-allowed' ? 'Microphone access is blocked. Allow it in your browser’s site settings.'
        : e.error === 'no-speech' ? 'No speech heard. Press Alt V and try again.'
          : e.error === 'network' ? 'Speech recognition needs an internet connection.'
            : 'Speech recognition stopped. Press Alt V and try again.',
    );
  };
  recognition.onend = () => {
    recognition = null;
    state.listening = false;
    paint();
  };
  recognition.start();
}

paint();
drawIdle();
document.fonts.load('700 26px "Atkinson Hyperlegible Next"').then(() => { if (!stream) drawIdle(); });
