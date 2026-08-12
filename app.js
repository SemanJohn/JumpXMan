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

// Penapisan Sambungan POSE tanpa Titik Muka (Hanya Bahu ke bawah)
const BODY_POSE_CONNECTIONS = POSE_CONNECTIONS.filter(([start, end]) => {
  return start >= 11 && end >= 11;
});

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
    // 1. Skeleton Badan (Bahu ke Bawah) - Muka Dikeluarkan
    if (results.poseLandmarks) {
      const bodyLandmarks = results.poseLandmarks.map((lm, index) => {
        if (index < 11) return { x: 0, y: 0, z: 0, visibility: 0 };
        return lm;
      });

      drawConnectors(canvasCtx, bodyLandmarks, BODY_POSE_CONNECTIONS, { color: '#00f3ff', lineWidth: 3 });
      drawLandmarks(canvasCtx, bodyLandmarks, { color: '#38bdf8', fillColor: '#ffffff', lineWidth: 2, radius: 4 });
    }

    // 2. Deteksi 5 Jari Tangan Kiri
    if (results.leftHandLandmarks) {
      drawConnectors(canvasCtx, results.leftHandLandmarks, HAND_CONNECTIONS, { color: '#ff007f', lineWidth: 2 });
      drawLandmarks(canvasCtx, results.leftHandLandmarks, { color: '#ffdd00', fillColor: '#ffffff', lineWidth: 1, radius: 3 });
    }

    // 3. Deteksi 5 Jari Tangan Kanan
    if (results.rightHandLandmarks) {
      drawConnectors(canvasCtx, results.rightHandLandmarks, HAND_CONNECTIONS, { color: '#ff007f', lineWidth: 2 });
      drawLandmarks(canvasCtx, results.rightHandLandmarks, { color: '#ffdd00', fillColor: '#ffffff', lineWidth: 1, radius: 3 });
    }
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
      leftHip.visibility < 0.4 || rightHip.visibility < 0.4) {
    jumpMeterBar.style.width = '0%';
    return;
  }

  const shoulderY = (leftShoulder.y + rightShoulder.y) / 2;
  const hipY = (leftHip.y + rightHip.y) / 2;
  const noseY = (nose && nose.visibility > 0.4) ? nose.y : shoulderY - 0.15;

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
