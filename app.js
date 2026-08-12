const videoElement = document.getElementById('webcam');
const canvasElement = document.getElementById('output_canvas');
const canvasCtx = canvasElement.getContext('2d');

const startBtn = document.getElementById('start-btn');
const resetBtn = document.getElementById('reset-btn');
const settingsBtn = document.getElementById('settings-btn');
const openSettingsBtn = document.getElementById('open-settings-btn');
const closeSettingsBtn = document.getElementById('close-settings-btn');
const saveSettingsBtn = document.getElementById('save-settings-btn');

const settingsModal = document.getElementById('settings-modal');
const startModeSelect = document.getElementById('start-mode-select');
const cameraSelect = document.getElementById('camera-select');
const sensitivitySelect = document.getElementById('sensitivity-select');
const skeletonToggle = document.getElementById('skeleton-toggle');

const metronomeToggle = document.getElementById('metronome-toggle');
const bpmSlider = document.getElementById('bpm-slider');
const bpmValueEl = document.getElementById('bpm-value');

const jumpCountEl = document.getElementById('jump-count');
const jumpStatusEl = document.getElementById('jump-status');
const jumpMeterBar = document.getElementById('jump-meter-bar');
const countdownOverlay = document.getElementById('countdown-overlay');
const countdownNumberEl = document.getElementById('countdown-number');
const gestureToast = document.getElementById('gesture-toast');
const gestureTextEl = document.getElementById('gesture-text');
const calibrationMsg = document.getElementById('calibration-msg');
const calibrationText = document.getElementById('calibration-text');
const pwaInstallBtn = document.getElementById('pwa-install-btn');

let camera = null;
let holistic = null;
let isCameraRunning = false;
let isSessionActive = false;
let isFullBodyVisible = false;
let isFrontCamera = true;
let jumpCount = 0;

let gesturePhase = 'NONE';
let isCountdownRunning = false;
let countdownTimerId = null;

let groundBaselineY = null;
let state = 'STANDING';
let lastJumpTime = 0;
const JUMP_COOLDOWN_MS = 250;

let audioCtx = null;
let metronomeIntervalId = null;

function playMetronomeClick() {
  try {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(1200, audioCtx.currentTime);
    gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.04);

    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.04);
  } catch (e) { console.error("Audio Error:", e); }
}

function updateMetronomeState() {
  if (metronomeIntervalId) {
    clearInterval(metronomeIntervalId);
    metronomeIntervalId = null;
  }

  if (isCameraRunning && isSessionActive && metronomeToggle.checked) {
    const bpm = parseInt(bpmSlider.value, 10) || 60;
    const intervalMs = (60 / bpm) * 1000;

    playMetronomeClick();
    metronomeIntervalId = setInterval(playMetronomeClick, intervalMs);
  }
}

bpmSlider.addEventListener('input', () => {
  bpmValueEl.textContent = `${bpmSlider.value} BPM`;
  updateMetronomeState();
});

metronomeToggle.addEventListener('change', updateMetronomeState);

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
    optBack.text = '📷 Kamera Belakang (Utama / Depth Scan)';
    cameraSelect.appendChild(optBack);

    videoDevices.forEach((device, index) => {
      const option = document.createElement('option');
      option.value = device.deviceId;
      option.text = device.label || `Kamera ${index + 1}`;
      cameraSelect.appendChild(option);
    });
  } catch (err) { console.error("Gagal kamera:", err); }
}

function startCountdownSequence(durationSec, onComplete) {
  if (isCountdownRunning) return;
  isCountdownRunning = true;

  let currentCount = durationSec;
  countdownNumberEl.textContent = currentCount;
  countdownOverlay.style.display = 'flex';
  
  jumpStatusEl.textContent = 'SEDIA...';
  jumpStatusEl.className = 'status-badge waiting';

  countdownTimerId = setInterval(() => {
    if (!isFullBodyVisible) return;

    currentCount--;
    if (currentCount > 0) {
      countdownNumberEl.textContent = currentCount;
      playMetronomeClick();
    } else {
      clearInterval(countdownTimerId);
      countdownTimerId = null;
      isCountdownRunning = false;
      countdownOverlay.style.display = 'none';

      isSessionActive = true;
      jumpStatusEl.textContent = 'SEDIA';
      jumpStatusEl.className = 'status-badge ready';
      
      updateMetronomeState();
      if (onComplete) onComplete();
    }
  }, 1000);
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
    width: { ideal: 1280, max: 1920 },
    height: { ideal: 720, max: 1080 },
    frameRate: { ideal: 60, min: 30 },
    facingMode: configFacing,
    deviceId: configDeviceId
  });

  await camera.start();
  isCameraRunning = true;
  isSessionActive = false;
  gesturePhase = 'NONE';

  startBtn.innerHTML = '⏸️ Berhenti';
  startBtn.classList.remove('btn-primary');
  startBtn.classList.add('btn-danger');

  const startMode = startModeSelect.value;
  if (startMode.startsWith('timer_')) {
    const seconds = parseInt(startMode.replace('timer_', ''), 10) || 5;
    gestureToast.style.display = 'none';
    startCountdownSequence(seconds);
  } else if (startMode === 'motion') {
    jumpStatusEl.textContent = 'MOTION...';
    jumpStatusEl.className = 'status-badge waiting';
    gestureToast.style.display = 'block';
    gestureTextEl.textContent = '✋ Tunjuk Tapak Tangan...';
  }
}

async function stopCamera() {
  if (camera) {
    try { await camera.stop(); } catch (e) {}
  }
  isCameraRunning = false;
  isSessionActive = false;
  isCountdownRunning = false;
  gesturePhase = 'NONE';

  if (countdownTimerId) {
    clearInterval(countdownTimerId);
    countdownTimerId = null;
  }

  countdownOverlay.style.display = 'none';
  gestureToast.style.display = 'none';

  startBtn.innerHTML = '▶️ Mula';
  startBtn.classList.remove('btn-danger');
  startBtn.classList.add('btn-primary');
  
  jumpStatusEl.textContent = 'OFF';
  jumpStatusEl.className = 'status-badge ready';
  jumpMeterBar.style.width = '0%';

  updateMetronomeState();
}

async function toggleCamera() {
  if (isCameraRunning) await stopCamera();
  else await startCamera();
}

cameraSelect.addEventListener('change', async () => {
  groundBaselineY = null;
  if (isCameraRunning) await startCamera();
});

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
    drawLine(ctx, lm[11], lm[12], '#38bdf8', 4);
    drawLine(ctx, lm[23], lm[24], '#38bdf8', 4);
    drawLine(ctx, lm[11], lm[23], '#38bdf8', 4);
    drawLine(ctx, lm[12], lm[24], '#38bdf8', 4);

    drawLine(ctx, lm[11], lm[13], '#00f3ff', 3);
    drawLine(ctx, lm[13], lm[15], '#00f3ff', 3);
    drawLine(ctx, lm[12], lm[14], '#00f3ff', 3);
    drawLine(ctx, lm[14], lm[16], '#00f3ff', 3);

    drawLine(ctx, lm[23], lm[25], '#22c55e', 4);
    drawLine(ctx, lm[25], lm[27], '#22c55e', 4);
    drawLine(ctx, lm[24], lm[26], '#22c55e', 4);
    drawLine(ctx, lm[26], lm[28], '#22c55e', 4);

    drawLine(ctx, lm[27], lm[29], '#ff9900', 3);
    drawLine(ctx, lm[29], lm[31], '#ff9900', 3);
    drawLine(ctx, lm[27], lm[31], '#ff9900', 3);

    drawLine(ctx, lm[28], lm[30], '#ff9900', 3);
    drawLine(ctx, lm[30], lm[32], '#ff9900', 3);
    drawLine(ctx, lm[28], lm[32], '#ff9900', 3);

    [27, 28, 29, 30, 31, 32].forEach(idx => {
      drawPoint(ctx, lm[idx], '#ffdd00', '#ffffff', 5);
    });

    [11, 12, 13, 14, 15, 16, 23, 24, 25, 26].forEach(idx => {
      drawPoint(ctx, lm[idx], '#00f3ff', '#ffffff', 5);
    });
  }

  if (results.leftHandLandmarks) {
    drawConnectors(ctx, results.leftHandLandmarks, HAND_CONNECTIONS, { color: '#ff007f', lineWidth: 2 });
    drawLandmarks(ctx, results.leftHandLandmarks, { color: '#ffdd00', fillColor: '#ffffff', lineWidth: 1, radius: 3 });
  }

  if (results.rightHandLandmarks) {
    drawConnectors(ctx, results.rightHandLandmarks, HAND_CONNECTIONS, { color: '#ff007f', lineWidth: 2 });
    drawLandmarks(ctx, results.rightHandLandmarks, { color: '#ffdd00', fillColor: '#ffffff', lineWidth: 1, radius: 3 });
  }
}

function processMotionGesture(handLandmarks) {
  if (!handLandmarks || isSessionActive || isCountdownRunning) return;

  const wrist = handLandmarks[0];
  const fingerTips = [4, 8, 12, 16, 20];

  let totalDist = 0;
  fingerTips.forEach(idx => {
    const tip = handLandmarks[idx];
    const dx = tip.x - wrist.x;
    const dy = tip.y - wrist.y;
    totalDist += Math.sqrt(dx * dx + dy * dy);
  });
  const avgDist = totalDist / fingerTips.length;

  if (gesturePhase === 'NONE' || gesturePhase === 'FIST_CLOSED') {
    if (avgDist > 0.22) {
      gesturePhase = 'PALM_OPEN';
      gestureToast.style.display = 'block';
      gestureTextEl.textContent = '✋ Tapak Tangan Dikesan! Sila Genggam (✊) untuk Mula';
    }
  } else if (gesturePhase === 'PALM_OPEN') {
    if (avgDist < 0.14) {
      gesturePhase = 'FIST_CLOSED';
      gestureToast.style.display = 'none';
      startCountdownSequence(3);
    }
  }
}

function validateFullBodyVisible(landmarks) {
  if (!landmarks) return false;
  const keypoints = [11, 12, 23, 24, 25, 26, 27, 28];
  let visibleCount = 0;
  keypoints.forEach(idx => {
    if (landmarks[idx] && landmarks[idx].visibility > 0.35) visibleCount++;
  });
  return visibleCount >= 6;
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

  isFullBodyVisible = validateFullBodyVisible(results.poseLandmarks);

  if (!isFullBodyVisible) {
    calibrationMsg.classList.add('warning');
    calibrationText.textContent = '⚠️ Pastikan keseluruhan tubuh (bahu hingga kaki) kelihatan di kamera!';
  } else {
    calibrationMsg.classList.remove('warning');
    calibrationText.textContent = '🧍 Keseluruhan tubuh dikesan dengan baik.';
  }

  if (skeletonToggle.checked) {
    drawCustomSkeleton(canvasCtx, results);
  }

  if (startModeSelect.value === 'motion') {
    if (results.leftHandLandmarks) processMotionGesture(results.leftHandLandmarks);
    else if (results.rightHandLandmarks) processMotionGesture(results.rightHandLandmarks);
  }

  if (isSessionActive && results.poseLandmarks && isFullBodyVisible) {
    detectJump(results.poseLandmarks);
  } else if (!isSessionActive) {
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
  const leftAnkle = landmarks[27];
  const rightAnkle = landmarks[28];
  const leftToe = landmarks[31];
  const rightToe = landmarks[32];

  if (!leftShoulder || !rightShoulder || !leftHip || !rightHip || !leftAnkle || !rightAnkle) {
    jumpMeterBar.style.width = '0%';
    return;
  }

  const shoulderY = (leftShoulder.y + rightShoulder.y) / 2;
  const hipY = (leftHip.y + rightHip.y) / 2;
  const noseY = (nose && nose.visibility > 0.3) ? nose.y : shoulderY - 0.15;
  const ankleY = (leftAnkle.y + rightAnkle.y) / 2;

  const currentBodyY = (noseY * 0.25) + (shoulderY * 0.25) + (hipY * 0.25) + (ankleY * 0.25);
  const torsoHeight = Math.abs(hipY - shoulderY);

  if (torsoHeight < 0.04) {
    jumpMeterBar.style.width = '0%';
    return;
  }

  if (groundBaselineY === null) {
    groundBaselineY = currentBodyY;
  } else {
    if (state === 'STANDING' && currentBodyY <= groundBaselineY + 0.05) {
      groundBaselineY = groundBaselineY * 0.92 + currentBodyY * 0.1;
    }
  }

  const sensitivity = sensitivitySelect.value;
  let factor = 0.12;
  if (sensitivity === 'high') factor = 0.07;
  if (sensitivity === 'low')  factor = 0.20;

  const requiredHeight = torsoHeight * factor;
  const jumpUpThreshold = groundBaselineY - requiredHeight;
  const landThreshold = groundBaselineY - (requiredHeight * 0.3);

  const displacement = groundBaselineY - currentBodyY;
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
  groundBaselineY = null;
  state = 'STANDING';
  jumpStatusEl.textContent = 'SEDIA';
  jumpStatusEl.className = 'status-badge ready';
  jumpMeterBar.style.width = '0%';
});

function toggleSettingsModal(show) {
  if (show) settingsModal.classList.add('active');
  else settingsModal.classList.remove('active');
}

openSettingsBtn.addEventListener('click', () => toggleSettingsModal(true));
settingsBtn.addEventListener('click', () => toggleSettingsModal(true));
closeSettingsBtn.addEventListener('click', () => toggleSettingsModal(false));
saveSettingsBtn.addEventListener('click', () => toggleSettingsModal(false));

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
EOF
}
});
EOF
}
