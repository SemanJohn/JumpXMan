const videoElement = document.getElementById('webcam');
const canvasElement = document.getElementById('output_canvas');
const canvasCtx = canvasElement.getContext('2d');

const startBtn = document.getElementById('start-btn');
const resetBtn = document.getElementById('reset-btn');

const cameraSelect = document.getElementById('camera-select');
const sensitivitySelect = document.getElementById('sensitivity-select');

const jumpCountEl = document.getElementById('jump-count');
const jumpStatusEl = document.getElementById('jump-status');
const jumpMeterBar = document.getElementById('jump-meter-bar');

const skeletonToggle = document.getElementById('skeleton-toggle');
const soundToggle = document.getElementById('sound-toggle');
const pwaInstallBtn = document.getElementById('pwa-install-btn');

let camera = null;
let holistic = null;
let isRunning = false;
let isFrontCamera = true;
let jumpCount = 0;

let baselineBodyY = null;
let state = 'STANDING';
let lastJumpTime = 0;
const JUMP_COOLDOWN_MS = 250;

let audioCtx = null;

function playBeep() {
  if (!soundToggle.checked) return;
  try {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, audioCtx.currentTime);
    gain.gain.setValueAtTime(0.12, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.18);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.18);
  } catch (e) { console.error("Audio error:", e); }
}

function initHolistic() {
  holistic = new Holistic({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/holistic/${file}`
  });

  holistic.setOptions({
    modelComplexity: 1,
    smoothLandmarks: true,
    enableSegmentation: false,
    refineFaceLandmarks: false,
    minDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5
  });

  holistic.onResults(onResults);
}

async function getCameras() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoDevices = devices.filter(device => device.kind === 'videoinput');
    
    cameraSelect.innerHTML = '';

    const optFront = document.createElement('option');
    optFront.value = 'user';
    optFront.text = '📷 Kamera Depan (Selfie)';
    cameraSelect.appendChild(optFront);

    const optBack = document.createElement('option');
    optBack.value = 'environment';
    optBack.text = '📷 Kamera Belakang (Utama)';
    cameraSelect.appendChild(optBack);

    videoDevices.forEach((device, index) => {
      const option = document.createElement('option');
      option.value = device.deviceId;
      option.text = device.label || `Kamera ${index + 1}`;
      cameraSelect.appendChild(option);
    });
  } catch (err) { console.error("Gagal kamera:", err); }
}

async function startCamera() {
  if (camera) {
    try { await camera.stop(); } catch (e) {}
  }

  const selectedValue = cameraSelect.value || 'user';
  let configFacing = 'user';
  let configDeviceId = undefined;

  if (selectedValue === 'user' || selectedValue === 'environment') {
    configFacing = selectedValue;
  } else {
    configDeviceId = { exact: selectedValue };
  }

  const selectedText = cameraSelect.options[cameraSelect.selectedIndex]?.text.toLowerCase() || '';
  isFrontCamera = (selectedValue === 'user') || selectedText.includes('front') || selectedText.includes('depan');

  camera = new Camera(videoElement, {
    onFrame: async () => { await holistic.send({ image: videoElement }); },
    width: 640,
    height: 480,
    facingMode: configFacing,
    deviceId: configDeviceId
  });

  await camera.start();
  isRunning = true;
  startBtn.innerHTML = '⏸️ Hentikan Kamera';
  startBtn.classList.remove('btn-primary');
  startBtn.classList.add('btn-danger');
  jumpStatusEl.textContent = 'SEDIA';
  jumpStatusEl.className = 'status-badge ready';
}

async function stopCamera() {
  if (camera) {
    try { await camera.stop(); } catch (e) {}
  }
  isRunning = false;
  startBtn.innerHTML = '▶️ Mula Kamera';
  startBtn.classList.remove('btn-danger');
  startBtn.classList.add('btn-primary');
  jumpStatusEl.textContent = 'OFF';
  jumpStatusEl.className = 'status-badge ready';
  jumpMeterBar.style.width = '0%';
}

async function toggleCamera() {
  if (isRunning) await stopCamera();
  else await startCamera();
}

cameraSelect.addEventListener('change', async () => {
  baselineBodyY = null;
  if (isRunning) await startCamera();
});

// Helper Lukisan Canvas Khas (Custom Skeleton Render)
function drawLine(ctx, p1, p2, color, width = 3) {
  if (!p1 || !p2 || (p1.visibility !== undefined && p1.visibility < 0.2) || (p2.visibility !== undefined && p2.visibility < 0.2)) return;
  ctx.beginPath();
  ctx.moveTo(p1.x * ctx.canvas.width, p1.y * ctx.canvas.height);
  ctx.lineTo(p2.x * ctx.canvas.width, p2.y * ctx.canvas.height);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.stroke();
}

function drawPoint(ctx, p, fillColor, strokeColor, radius = 5) {
  if (!p || (p.visibility !== undefined && p.visibility < 0.2)) return;
  const x = p.x * ctx.canvas.width;
  const y = p.y * ctx.canvas.height;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, 2 * Math.PI);
  ctx.fillStyle = fillColor;
  ctx.fill();
  if (strokeColor) {
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

function drawCustomSkeleton(ctx, results) {
  const lm = results.poseLandmarks;

  if (lm) {
    // 1. Torso / Pinggul (Biru Neon)
    drawLine(ctx, lm[11], lm[12], '#38bdf8', 4);
    drawLine(ctx, lm[23], lm[24], '#38bdf8', 4);
    drawLine(ctx, lm[11], lm[23], '#38bdf8', 4);
    drawLine(ctx, lm[12], lm[24], '#38bdf8', 4);

    // 2. Tangan & Lengan (Cyan Neon)
    drawLine(ctx, lm[11], lm[13], '#00f3ff', 3);
    drawLine(ctx, lm[13], lm[15], '#00f3ff', 3);
    drawLine(ctx, lm[12], lm[14], '#00f3ff', 3);
    drawLine(ctx, lm[14], lm[16], '#00f3ff', 3);

    // 3. Kaki (Hijau Lime Neon)
    drawLine(ctx, lm[23], lm[25], '#22c55e', 4);
    drawLine(ctx, lm[25], lm[27], '#22c55e', 4);
    drawLine(ctx, lm[24], lm[26], '#22c55e', 4);
    drawLine(ctx, lm[26], lm[28], '#22c55e', 4);

    // 4. KAKI & JARI KAKI (FEET & TOES - Oren Neon)
    // Left Foot: Ankle -> Heel -> Toe Index -> Ankle
    drawLine(ctx, lm[27], lm[29], '#ff9900', 3);
    drawLine(ctx, lm[29], lm[31], '#ff9900', 3);
    drawLine(ctx, lm[27], lm[31], '#ff9900', 3);

    // Right Foot: Ankle -> Heel -> Toe Index -> Ankle
    drawLine(ctx, lm[28], lm[30], '#ff9900', 3);
    drawLine(ctx, lm[30], lm[32], '#ff9900', 3);
    drawLine(ctx, lm[28], lm[32], '#ff9900', 3);

    // Sendi Kaki & Jari Kaki
    [27, 28, 29, 30, 31, 32].forEach(idx => {
      drawPoint(ctx, lm[idx], '#ffdd00', '#ffffff', 5);
    });

    // Sendi Badan Utama
    [11, 12, 13, 14, 15, 16, 23, 24, 25, 26].forEach(idx => {
      drawPoint(ctx, lm[idx], '#00f3ff', '#ffffff', 5);
    });
  }

  // 5. DETEKSI 5 JARI TANGAN (HANDS - Pink/Magenta & Yellow)
  if (results.leftHandLandmarks) {
    drawConnectors(ctx, results.leftHandLandmarks, HAND_CONNECTIONS, { color: '#ff007f', lineWidth: 2 });
    drawLandmarks(ctx, results.leftHandLandmarks, { color: '#ffdd00', fillColor: '#ffffff', lineWidth: 1, radius: 3 });
  }

  if (results.rightHandLandmarks) {
    drawConnectors(ctx, results.rightHandLandmarks, HAND_CONNECTIONS, { color: '#ff007f', lineWidth: 2 });
    drawLandmarks(ctx, results.rightHandLandmarks, { color: '#ffdd00', fillColor: '#ffffff', lineWidth: 1, radius: 3 });
  }
}

function onResults(results) {
  canvasElement.width = videoElement.videoWidth || 640;
  canvasElement.height = videoElement.videoHeight || 480;

  canvasCtx.save();
  canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);

  if (isFrontCamera) {
    canvasCtx.translate(canvasElement.width, 0);
    canvasCtx.scale(-1, 1);
  }

  canvasCtx.drawImage(results.image, 0, 0, canvasElement.width, canvasElement.height);

  if (skeletonToggle.checked) {
    drawCustomSkeleton(canvasCtx, results);
  }

  if (results.poseLandmarks) {
    detectJump(results.poseLandmarks);
  } else {
    jumpMeterBar.style.width = '0%';
  }

  canvasCtx.restore();
}

function detectJump(landmarks) {
  const nose = landmarks[0];
  const leftShoulder = landmarks[11];
  const rightShoulder = landmarks[12];
  const leftHip = landmarks[23];
  const rightHip = landmarks[24];

  if (!leftShoulder || !rightShoulder || !leftHip || !rightHip ||
      leftHip.visibility < 0.3 || rightHip.visibility < 0.3) {
    jumpMeterBar.style.width = '0%';
    return;
  }

  const shoulderY = (leftShoulder.y + rightShoulder.y) / 2;
  const hipY = (leftHip.y + rightHip.y) / 2;
  const noseY = (nose && nose.visibility > 0.3) ? nose.y : shoulderY - 0.15;

  const currentBodyY = (noseY * 0.3) + (shoulderY * 0.35) + (hipY * 0.35);
  const torsoHeight = Math.abs(hipY - shoulderY);

  if (torsoHeight < 0.04) {
    jumpMeterBar.style.width = '0%';
    return;
  }

  if (baselineBodyY === null) {
    baselineBodyY = currentBodyY;
  } else {
    if (state === 'STANDING' && currentBodyY <= baselineBodyY + 0.05) {
      baselineBodyY = baselineBodyY * 0.9 + currentBodyY * 0.1;
    }
  }

  const sensitivity = sensitivitySelect.value;
  let factor = 0.12;
  if (sensitivity === 'high') factor = 0.07;
  if (sensitivity === 'low')  factor = 0.20;

  const requiredHeight = torsoHeight * factor;
  const jumpUpThreshold = baselineBodyY - requiredHeight;
  const landThreshold = baselineBodyY - (requiredHeight * 0.3);

  const displacement = baselineBodyY - currentBodyY;
  const progressPercent = Math.min(100, Math.max(0, (displacement / requiredHeight) * 100));
  jumpMeterBar.style.width = `${progressPercent}%`;

  const now = Date.now();

  if (state === 'STANDING') {
    if (currentBodyY < jumpUpThreshold && (now - lastJumpTime > JUMP_COOLDOWN_MS)) {
      state = 'IN_AIR';
      jumpStatusEl.textContent = 'LOMPAT!';
      jumpStatusEl.className = 'status-badge jumping';
    }
  } else if (state === 'IN_AIR') {
    if (currentBodyY > landThreshold) {
      jumpCount++;
      jumpCountEl.textContent = jumpCount;
      playBeep();

      state = 'STANDING';
      lastJumpTime = now;
      jumpStatusEl.textContent = 'SEDIA';
      jumpStatusEl.className = 'status-badge ready';
    }
  }
}

resetBtn.addEventListener('click', () => {
  jumpCount = 0;
  jumpCountEl.textContent = '0';
  baselineBodyY = null;
  state = 'STANDING';
  jumpStatusEl.textContent = 'SEDIA';
  jumpStatusEl.className = 'status-badge ready';
  jumpMeterBar.style.width = '0%';
});

startBtn.addEventListener('click', toggleCamera);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(err => console.error(err));
  });
}

let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  pwaInstallBtn.style.display = 'block';
});

pwaInstallBtn.addEventListener('click', () => {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    deferredPrompt = null;
    pwaInstallBtn.style.display = 'none';
  }
});

window.addEventListener('DOMContentLoaded', () => {
  initHolistic();
  getCameras();
});
