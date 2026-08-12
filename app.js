(() => {
  "use strict";

  const APP_VERSION = "2.2.0";
  const UPDATE_CHECK_MS = 5 * 60 * 1000;
  const JUMP_COOLDOWN_MS = 450;

  const $ = (id) => document.getElementById(id);

  const el = {
    video: $("webcam"),
    canvas: $("output_canvas"),
    start: $("start-btn"),
    reset: $("reset-btn"),

    openSettings: $("open-settings-btn"),
    closeSettings: $("close-settings-btn"),
    saveSettings: $("save-settings-btn"),

    modal: $("settings-modal"),
    startMode: $("start-mode-select"),
    camera: $("camera-select"),
    sensitivity: $("sensitivity-select"),
    skeleton: $("skeleton-toggle"),

    metronome: $("metronome-toggle"),
    bpm: $("bpm-slider"),
    bpmValue: $("bpm-value"),

    count: $("jump-count"),
    status: $("jump-status"),
    meter: $("jump-meter-bar"),

    countdown: $("countdown-overlay"),
    countdownNumber: $("countdown-number"),

    gesture: $("gesture-toast"),
    gestureText: $("gesture-text"),

    calibration: $("calibration-msg"),
    calibrationText: $("calibration-text"),

    install: $("pwa-install-btn"),
    appVersion: $("app-version")
  };

  if (Object.values(el).some((node) => !node)) {
    console.error(
      "JumpXMan: Elemen antaramuka tidak lengkap."
    );

    return;
  }

  const ctx = el.canvas.getContext("2d");

  let stream = null;
  let holistic = null;

  let modelReady = false;
  let modelReadyPromise = null;
  let processingFrame = false;
  let animationId = 0;

  let cameraRunning = false;
  let sessionActive = false;
  let fullBodyVisible = false;
  let frontCamera = true;

  let jumpCount = 0;
  let jumpState = "STANDING";

  let baselineBodyY = null;
  let baselineAnkleY = null;
  let lastJumpAt = 0;

  let gesturePhase = "NONE";
  let openPalmFrames = 0;
  let lostPalmFrames = 0;

  let waveCenterX = null;
  let waveLastSide = null;
  let waveSideChanges = 0;
  let waveThresholdX = 0.05;

  let gestureHandSide = null;
  let gestureStartedAt = 0;
  let gestureTimerId = null;

  let countdownId = null;
  let countdownRunning = false;

  let metronomeId = null;
  let audioContext = null;

  let deferredInstallPrompt = null;
  let serviceWorkerRegistration = null;
  let updateCheckId = null;
  let reloadingForUpdate = false;

  el.appVersion.textContent =
    `v${APP_VERSION}`;

  function setStatus(
    text,
    type = "ready"
  ) {
    el.status.textContent = text;

    el.status.className =
      `status-badge ${type}`;
  }

  function showMessage(
    text,
    warning = false
  ) {
    el.calibrationText.textContent = text;

    el.calibration.classList.toggle(
      "warning",
      warning
    );
  }

  function openModal() {
    el.modal.hidden = false;
    document.body.style.overflow = "hidden";
  }

  function closeModal() {
    el.modal.hidden = true;
    document.body.style.overflow = "";
  }

  function resetJumpData() {
    jumpCount = 0;
    jumpState = "STANDING";

    baselineBodyY = null;
    baselineAnkleY = null;
    lastJumpAt = 0;

    el.count.textContent = "0";
    el.meter.style.width = "0%";

    if (!cameraRunning) {
      setStatus("SEDIA", "ready");
    } else if (!sessionActive) {
      setStatus("MENUNGGU", "waiting");
    } else {
      setStatus("SEDIA", "ready");
    }
  }

  function clearCameraView() {
    ctx.save();

    ctx.setTransform(
      1,
      0,
      0,
      1,
      0,
      0
    );

    ctx.clearRect(
      0,
      0,
      el.canvas.width,
      el.canvas.height
    );

    ctx.restore();
  }

  function resetMotionGesture(
    message =
      "✋ Tunjuk tapak tangan dan kekalkan terbuka..."
  ) {
    clearTimeout(gestureTimerId);

    gestureTimerId = null;
    gesturePhase = "NONE";

    openPalmFrames = 0;
    lostPalmFrames = 0;

    waveCenterX = null;
    waveLastSide = null;
    waveSideChanges = 0;
    waveThresholdX = 0.05;

    gestureHandSide = null;
    gestureStartedAt = 0;

    el.gestureText.textContent = message;
  }

  async function resetApplication() {
    await stopCamera(false);

    resetJumpData();
    clearCameraView();

    setStatus("SEDIA", "ready");

    showMessage(
      "🧍 Tekan Mula dan benarkan akses kamera."
    );
  }

  function playClick() {
    try {
      audioContext ||= new (
        window.AudioContext ||
        window.webkitAudioContext
      )();

      if (audioContext.state === "suspended") {
        audioContext.resume();
      }

      const oscillator =
        audioContext.createOscillator();

      const gain =
        audioContext.createGain();

      oscillator.type = "triangle";
      oscillator.frequency.value = 1200;

      gain.gain.setValueAtTime(
        0.14,
        audioContext.currentTime
      );

      gain.gain.exponentialRampToValueAtTime(
        0.0001,
        audioContext.currentTime + 0.045
      );

      oscillator
        .connect(gain)
        .connect(audioContext.destination);

      oscillator.start();

      oscillator.stop(
        audioContext.currentTime + 0.05
      );
    } catch (error) {
      console.warn(
        "Audio tidak tersedia:",
        error
      );
    }
  }

  function updateMetronome() {
    clearInterval(metronomeId);
    metronomeId = null;

    if (
      cameraRunning &&
      sessionActive &&
      el.metronome.checked
    ) {
      const bpm =
        Number(el.bpm.value) || 60;

      playClick();

      metronomeId = setInterval(
        playClick,
        60000 / bpm
      );
    }
  }

  function cancelCountdown() {
    clearInterval(countdownId);

    countdownId = null;
    countdownRunning = false;

    el.countdown.hidden = true;
  }

  function startCountdown(seconds) {
    if (countdownRunning) return;

    countdownRunning = true;

    let remaining = seconds;

    el.countdownNumber.textContent =
      String(remaining);

    el.countdown.hidden = false;

    setStatus("SEDIA...", "waiting");
    playClick();

    countdownId = setInterval(() => {
      if (!fullBodyVisible) {
        showMessage(
          "⚠️ Undur sehingga bahu, badan dan kedua-dua kaki kelihatan.",
          true
        );

        return;
      }

      remaining -= 1;

      if (remaining > 0) {
        el.countdownNumber.textContent =
          String(remaining);

        playClick();
        return;
      }

      cancelCountdown();

      sessionActive = true;

      baselineBodyY = null;
      baselineAnkleY = null;
      jumpState = "STANDING";

      setStatus("SEDIA", "ready");
      updateMetronome();
    }, 1000);
  }

  function savePreferences() {
    const settings = {
      startMode: el.startMode.value,
      camera: el.camera.value,
      sensitivity: el.sensitivity.value,
      skeleton: el.skeleton.checked,
      metronome: el.metronome.checked,
      bpm: el.bpm.value
    };

    try {
      localStorage.setItem(
        "jumpxman-settings-v2",
        JSON.stringify(settings)
      );
    } catch (error) {
      console.warn(
        "Tetapan tidak dapat disimpan:",
        error
      );
    }
  }

  function loadPreferences() {
    try {
      const settings = JSON.parse(
        localStorage.getItem(
          "jumpxman-settings-v2"
        ) || "{}"
      );

      if (settings.startMode) {
        el.startMode.value =
          settings.startMode;
      }

      if (settings.camera) {
        el.camera.value =
          settings.camera;
      }

      if (settings.sensitivity) {
        el.sensitivity.value =
          settings.sensitivity;
      }

      if (
        typeof settings.skeleton ===
        "boolean"
      ) {
        el.skeleton.checked =
          settings.skeleton;
      }

      if (
        typeof settings.metronome ===
        "boolean"
      ) {
        el.metronome.checked =
          settings.metronome;
      }

      if (settings.bpm) {
        el.bpm.value = settings.bpm;
      }
    } catch (error) {
      console.warn(
        "Tetapan tidak dapat dibaca:",
        error
      );
    }

    el.bpmValue.textContent =
      `${el.bpm.value} BPM`;
  }

  async function initializeModel() {
    if (
      typeof window.Holistic !==
      "function"
    ) {
      modelReady = false;

      showMessage(
        "⚠️ AI gagal dimuat. Semak sambungan internet.",
        true
      );

      return;
    }

    try {
      holistic = new window.Holistic({
        locateFile: (file) => {
          return (
            "https://cdn.jsdelivr.net/npm/" +
            "@mediapipe/holistic/" +
            file
          );
        }
      });

      holistic.setOptions({
        modelComplexity: 1,
        smoothLandmarks: true,
        enableSegmentation: false,
        refineFaceLandmarks: false,
        minDetectionConfidence: 0.45,
        minTrackingConfidence: 0.45
      });

      holistic.onResults(onResults);

      modelReady = true;
    } catch (error) {
      console.error(
        "Model AI gagal dimulakan:",
        error
      );

      modelReady = false;

      showMessage(
        "⚠️ AI gagal dimulakan. Muat semula aplikasi.",
        true
      );
    }
  }

  async function ensureModelReady(
    timeoutMs = 8000
  ) {
    if (modelReady) return true;

    if (modelReadyPromise) {
      return modelReadyPromise;
    }

    modelReadyPromise = (async () => {
      const deadline =
        Date.now() + timeoutMs;

      while (
        typeof window.Holistic !==
          "function" &&
        Date.now() < deadline
      ) {
        await new Promise(
          (resolve) =>
            setTimeout(resolve, 100)
        );
      }

      if (!modelReady) {
        await initializeModel();
      }

      return modelReady;
    })();

    try {
      return await modelReadyPromise;
    } finally {
      modelReadyPromise = null;
    }
  }

  async function listCameras() {
    if (
      !navigator.mediaDevices
        ?.enumerateDevices
    ) {
      return;
    }

    try {
      const devices = (
        await navigator.mediaDevices
          .enumerateDevices()
      ).filter(
        (device) =>
          device.kind === "videoinput"
      );

      const current =
        el.camera.value;

      el.camera.innerHTML = "";

      const choices = [
        [
          "user",
          "📷 Kamera Depan (Selfie)"
        ],
        [
          "environment",
          "📷 Kamera Belakang (Utama)"
        ]
      ];

      for (
        const [value, label] of choices
      ) {
        el.camera.add(
          new Option(label, value)
        );
      }

      devices.forEach(
        (device, index) => {
          if (!device.deviceId) return;

          el.camera.add(
            new Option(
              device.label ||
                `Kamera ${index + 1}`,
              device.deviceId
            )
          );
        }
      );

      const cameraExists =
        [...el.camera.options].some(
          (option) =>
            option.value === current
        );

      if (cameraExists) {
        el.camera.value = current;
      }
    } catch (error) {
      console.warn(
        "Senarai kamera gagal dibaca:",
        error
      );
    }
  }

  function cameraConstraints(value) {
    const base = {
      width: {
        ideal: 1280
      },

      height: {
        ideal: 720
      },

      frameRate: {
        ideal: 30,
        max: 60
      }
    };

    if (
      value === "user" ||
      value === "environment"
    ) {
      return {
        ...base,

        facingMode: {
          ideal: value
        }
      };
    }

    return {
      ...base,

      deviceId: {
        exact: value
      }
    };
  }

  async function startCamera() {
    if (cameraRunning) return;

    el.start.disabled = true;

    try {
      if (
        !window.isSecureContext ||
        !navigator.mediaDevices
          ?.getUserMedia
      ) {
        throw new Error(
          "Kamera memerlukan alamat HTTPS."
        );
      }

      if (!modelReady) {
        await ensureModelReady();
      }

      if (!modelReady) {
        throw new Error(
          "Model AI belum tersedia. Pastikan internet aktif."
        );
      }

      if (el.metronome.checked) {
        playClick();
      }

      const selected =
        el.camera.value || "user";

      const selectedText =
        el.camera
          .selectedOptions[0]
          ?.text
          .toLowerCase() || "";

      frontCamera =
        selected === "user" ||
        selectedText.includes("depan");

      stream =
        await navigator.mediaDevices
          .getUserMedia({
            audio: false,

            video:
              cameraConstraints(selected)
          });

      el.video.srcObject = stream;

      await el.video.play();

      cameraRunning = true;
      sessionActive = false;

      resetMotionGesture();

      el.start.textContent =
        "⏹️ Berhenti";

      el.start.classList.remove(
        "btn-primary"
      );

      el.start.classList.add(
        "btn-danger"
      );

      setStatus(
        "MEMUAT AI",
        "waiting"
      );

      showMessage(
        "🧍 Undur sehingga keseluruhan tubuh kelihatan."
      );

      await listCameras();

      frameLoop();

      if (
        el.startMode.value === "motion"
      ) {
        el.gesture.hidden = false;

        el.gestureText.textContent =
          "✋ Tunjuk tapak tangan dan kekalkan terbuka...";

        setStatus(
          "MOTION...",
          "waiting"
        );
      } else {
        el.gesture.hidden = true;

        const seconds =
          Number(
            el.startMode.value.replace(
              "timer_",
              ""
            )
          ) || 5;

        startCountdown(seconds);
      }
    } catch (error) {
      console.error(
        "Kamera gagal:",
        error
      );

      const denied =
        error?.name ===
        "NotAllowedError";

      const message = denied
        ? "Akses kamera ditolak. Benarkan Camera dalam tetapan Safari."
        : (
            error.message ||
            "Kamera gagal dimulakan."
          );

      setStatus("RALAT", "error");

      showMessage(
        `⚠️ ${message}`,
        true
      );

      await stopCamera(false);
    } finally {
      el.start.disabled = false;
    }
  }

  async function stopCamera(
    updateLabel = true
  ) {
    cancelAnimationFrame(animationId);

    animationId = 0;

    cancelCountdown();

    clearInterval(metronomeId);
    metronomeId = null;

    sessionActive = false;
    cameraRunning = false;
    processingFrame = false;
    fullBodyVisible = false;

    resetMotionGesture();

    if (stream) {
      stream
        .getTracks()
        .forEach(
          (track) => track.stop()
        );
    }

    stream = null;

    el.video.srcObject = null;
    el.video.removeAttribute("src");
    el.video.load();

    el.gesture.hidden = true;
    el.meter.style.width = "0%";

    clearCameraView();

    el.start.textContent = "▶️ Mula";

    el.start.classList.remove(
      "btn-danger"
    );

    el.start.classList.add(
      "btn-primary"
    );

    if (updateLabel) {
      setStatus("SEDIA", "ready");

      showMessage(
        "🧍 Tekan Mula dan benarkan akses kamera."
      );
    }
  }

  async function frameLoop() {
    if (!cameraRunning) return;

    if (
      el.video.readyState >= 2 &&
      holistic &&
      !processingFrame
    ) {
      processingFrame = true;

      try {
        await holistic.send({
          image: el.video
        });
      } catch (error) {
        console.error(
          "Ralat bingkai AI:",
          error
        );
      } finally {
        processingFrame = false;
      }
    }

    animationId =
      requestAnimationFrame(frameLoop);
  }

  function visible(
    point,
    minimum = 0.25
  ) {
    return (
      point &&
      (
        point.visibility === undefined ||
        point.visibility >= minimum
      )
    );
  }

  function drawLine(
    pointA,
    pointB,
    color,
    width = 3
  ) {
    if (
      !visible(pointA) ||
      !visible(pointB)
    ) {
      return;
    }

    ctx.beginPath();

    ctx.moveTo(
      pointA.x * el.canvas.width,
      pointA.y * el.canvas.height
    );

    ctx.lineTo(
      pointB.x * el.canvas.width,
      pointB.y * el.canvas.height
    );

    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = "round";

    ctx.stroke();
  }

  function drawPoint(
    point,
    color,
    radius = 5
  ) {
    if (!visible(point)) return;

    ctx.beginPath();

    ctx.arc(
      point.x * el.canvas.width,
      point.y * el.canvas.height,
      radius,
      0,
      Math.PI * 2
    );

    ctx.fillStyle = color;
    ctx.fill();

    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  function drawSkeleton(results) {
    const points =
      results.poseLandmarks;

    if (points) {
      const torsoLines = [
        [11, 12],
        [11, 23],
        [12, 24],
        [23, 24]
      ];

      const armLines = [
        [11, 13],
        [13, 15],
        [12, 14],
        [14, 16]
      ];

      const legLines = [
        [23, 25],
        [25, 27],
        [24, 26],
        [26, 28]
      ];

      const footLines = [
        [27, 29],
        [29, 31],
        [27, 31],
        [28, 30],
        [30, 32],
        [28, 32]
      ];

      torsoLines.forEach(
        ([a, b]) => {
          drawLine(
            points[a],
            points[b],
            "#38bdf8",
            4
          );
        }
      );

      armLines.forEach(
        ([a, b]) => {
          drawLine(
            points[a],
            points[b],
            "#00f3ff",
            3
          );
        }
      );

      legLines.forEach(
        ([a, b]) => {
          drawLine(
            points[a],
            points[b],
            "#22c55e",
            4
          );
        }
      );

      footLines.forEach(
        ([a, b]) => {
          drawLine(
            points[a],
            points[b],
            "#ff9900",
            3
          );
        }
      );

      const pointIndexes = [
        11, 12, 13, 14,
        15, 16, 23, 24,
        25, 26, 27, 28,
        29, 30, 31, 32
      ];

      pointIndexes.forEach(
        (index) => {
          drawPoint(
            points[index],
            index >= 27
              ? "#ffdd00"
              : "#00f3ff"
          );
        }
      );
    }

    if (
      typeof window.drawConnectors !==
        "function" ||
      typeof window.drawLandmarks !==
        "function"
    ) {
      return;
    }

    const hands = [
      results.leftHandLandmarks,
      results.rightHandLandmarks
    ];

    for (const hand of hands) {
      if (!hand) continue;

      window.drawConnectors(
        ctx,
        hand,
        window.HAND_CONNECTIONS,
        {
          color: "#ff007f",
          lineWidth: 2
        }
      );

      window.drawLandmarks(
        ctx,
        hand,
        {
          color: "#ffdd00",
          fillColor: "#ffffff",
          radius: 3
        }
      );
    }
  }

  function validateBody(points) {
    if (!points) return false;

    const essentialPoints = [
      11,
      12,
      23,
      24,
      25,
      26,
      27,
      28
    ];

    const visibleCount =
      essentialPoints.filter(
        (index) =>
          visible(points[index], 0.4)
      ).length;

    return visibleCount >= 7;
  }

  function distance2D(a, b) {
    return Math.hypot(
      a.x - b.x,
      a.y - b.y
    );
  }

  function isOpenPalm(hand) {
    if (
      !hand ||
      hand.length < 21
    ) {
      return false;
    }

    const wrist = hand[0];

    const palmSize =
      distance2D(wrist, hand[9]);

    if (palmSize < 0.025) {
      return false;
    }

    const fingers = [
      [8, 6],
      [12, 10],
      [16, 14],
      [20, 18]
    ];

    const extendedFingers =
      fingers.filter(
        ([tip, pip]) => {
          return (
            distance2D(
              wrist,
              hand[tip]
            ) >
            distance2D(
              wrist,
              hand[pip]
            ) * 1.12
          );
        }
      ).length;

    const thumbOpen =
      distance2D(
        hand[4],
        hand[5]
      ) >
      palmSize * 0.55;

    const fingersSpread =
      distance2D(
        hand[8],
        hand[20]
      ) >
      palmSize * 0.75;

    return (
      extendedFingers >= 3 &&
      (
        thumbOpen ||
        fingersSpread
      )
    );
  }

  function processGesture(
    hand,
    posePoints,
    detectedSide
  ) {
    if (
      sessionActive ||
      countdownRunning
    ) {
      return;
    }

    if (
      gesturePhase ===
      "WAVE_COMPLETE"
    ) {
      return;
    }

    const palmOpen =
      isOpenPalm(hand);

    let wristX =
      palmOpen
        ? hand[0].x
        : null;

    let palmWidth =
      palmOpen
        ? Math.max(
            distance2D(
              hand[5],
              hand[17]
            ),
            0.04
          )
        : null;

    if (
      !palmOpen &&
      gesturePhase ===
        "PALM_READY" &&
      posePoints &&
      gestureHandSide
    ) {
      const wristIndex =
        gestureHandSide === "LEFT"
          ? 15
          : 16;

      const poseWrist =
        posePoints[wristIndex];

      if (
        visible(poseWrist, 0.3)
      ) {
        wristX = poseWrist.x;
      }
    }

    if (wristX === null) {
      lostPalmFrames += 1;

      if (lostPalmFrames > 18) {
        resetMotionGesture(
          "✋ Tapak tangan hilang. Tunjukkan semula..."
        );
      }

      return;
    }

    lostPalmFrames = 0;

    if (palmOpen) {
      openPalmFrames += 1;
    }

    if (gesturePhase === "NONE") {
      if (!palmOpen) return;

      if (openPalmFrames < 6) {
        el.gestureText.textContent =
          "✋ Mengesan tapak tangan...";

        return;
      }

      gesturePhase = "PALM_READY";

      waveCenterX = wristX;

      waveThresholdX = Math.max(
        0.045,
        palmWidth * 0.55
      );

      gestureHandSide =
        detectedSide;

      gestureStartedAt =
        Date.now();

      el.gestureText.textContent =
        "👋 Bagus! Lambai tangan kiri dan kanan";

      return;
    }

    if (
      Date.now() -
        gestureStartedAt >
      6500
    ) {
      resetMotionGesture(
        "⌛ Cuba lagi: tunjuk tapak tangan, kemudian lambai kiri–kanan"
      );

      return;
    }

    let currentSide = null;

    if (
      wristX <
      waveCenterX - waveThresholdX
    ) {
      currentSide = "LEFT";
    }

    if (
      wristX >
      waveCenterX + waveThresholdX
    ) {
      currentSide = "RIGHT";
    }

    if (
      !currentSide ||
      currentSide === waveLastSide
    ) {
      return;
    }

    if (waveLastSide === null) {
      waveLastSide = currentSide;

      el.gestureText.textContent =
        "👋 Sekarang lambai ke sebelah bertentangan...";

      return;
    }

    waveLastSide = currentSide;
    waveSideChanges += 1;

    if (waveSideChanges >= 1) {
      gesturePhase =
        "WAVE_COMPLETE";

      el.gestureText.textContent =
        "✅ Lambai dikesan! Timer bermula";

      gestureTimerId =
        setTimeout(() => {
          gestureTimerId = null;

          if (!cameraRunning) {
            return;
          }

          el.gesture.hidden = true;

          startCountdown(3);
        }, 250);
    }
  }

  function detectJump(points) {
    const shoulderY =
      (
        points[11].y +
        points[12].y
      ) / 2;

    const hipY =
      (
        points[23].y +
        points[24].y
      ) / 2;

    const ankleY =
      (
        points[27].y +
        points[28].y
      ) / 2;

    const torsoHeight =
      Math.abs(
        hipY - shoulderY
      );

    if (torsoHeight < 0.045) {
      return;
    }

    const bodyY =
      hipY * 0.7 +
      shoulderY * 0.3;

    if (
      baselineBodyY === null ||
      baselineAnkleY === null
    ) {
      baselineBodyY = bodyY;
      baselineAnkleY = ankleY;

      return;
    }

    const sensitivityFactors = {
      high: 0.075,
      medium: 0.115,
      low: 0.17
    };

    const selectedFactor =
      sensitivityFactors[
        el.sensitivity.value
      ] ||
      sensitivityFactors.medium;

    const bodyRequired =
      torsoHeight *
      selectedFactor;

    const ankleRequired =
      torsoHeight *
      (
        el.sensitivity.value ===
          "high"
          ? 0.08
          : 0.12
      );

    const bodyLift =
      baselineBodyY - bodyY;

    const ankleLift =
      baselineAnkleY - ankleY;

    const progress = Math.min(
      100,
      Math.max(
        0,
        Math.min(
          bodyLift / bodyRequired,
          ankleLift / ankleRequired
        ) * 100
      )
    );

    el.meter.style.width =
      `${progress}%`;

    const now = Date.now();

    if (
      jumpState === "STANDING"
    ) {
      if (
        Math.abs(ankleLift) <
        ankleRequired * 0.45
      ) {
        baselineBodyY =
          baselineBodyY * 0.92 +
          bodyY * 0.08;

        baselineAnkleY =
          baselineAnkleY * 0.92 +
          ankleY * 0.08;
      }

      if (
        bodyLift > bodyRequired &&
        ankleLift > ankleRequired &&
        now - lastJumpAt >
          JUMP_COOLDOWN_MS
      ) {
        jumpState = "IN_AIR";

        setStatus(
          "LOMPAT!",
          "jumping"
        );
      }
    } else if (
      bodyLift <
        bodyRequired * 0.3 &&
      ankleLift <
        ankleRequired * 0.4
    ) {
      jumpCount += 1;

      el.count.textContent =
        String(jumpCount);

      jumpState = "STANDING";
      lastJumpAt = now;

      setStatus(
        "SEDIA",
        "ready"
      );
    }
  }

  function onResults(results) {
    const width =
      el.video.videoWidth || 640;

    const height =
      el.video.videoHeight || 480;

    if (
      el.canvas.width !== width ||
      el.canvas.height !== height
    ) {
      el.canvas.width = width;
      el.canvas.height = height;
    }

    ctx.save();

    ctx.clearRect(
      0,
      0,
      width,
      height
    );

    if (frontCamera) {
      ctx.translate(width, 0);
      ctx.scale(-1, 1);
    }

    ctx.drawImage(
      results.image,
      0,
      0,
      width,
      height
    );

    fullBodyVisible =
      validateBody(
        results.poseLandmarks
      );

    if (fullBodyVisible) {
      showMessage(
        "🧍 Keseluruhan tubuh dikesan dengan baik."
      );
    } else {
      showMessage(
        "⚠️ Pastikan bahu, badan dan kedua-dua kaki kelihatan.",
        true
      );
    }

    if (el.skeleton.checked) {
      drawSkeleton(results);
    }

    if (
      el.startMode.value ===
      "motion"
    ) {
      const hands = [
        {
          hand:
            results.leftHandLandmarks,
          side: "LEFT"
        },
        {
          hand:
            results.rightHandLandmarks,
          side: "RIGHT"
        }
      ].filter(
        (item) => item.hand
      );

      const selectedHand =
        hands.find(
          (item) =>
            isOpenPalm(item.hand)
        ) ||
        hands[0] ||
        {};

      processGesture(
        selectedHand.hand,
        results.poseLandmarks,
        selectedHand.side
      );
    }

    if (
      sessionActive &&
      fullBodyVisible &&
      results.poseLandmarks
    ) {
      detectJump(
        results.poseLandmarks
      );
    } else if (!sessionActive) {
      el.meter.style.width = "0%";
    }

    ctx.restore();
  }

  function bindControls() {
    el.openSettings.addEventListener(
      "click",
      openModal
    );

    el.closeSettings.addEventListener(
      "click",
      closeModal
    );

    el.saveSettings.addEventListener(
      "click",
      () => {
        savePreferences();
        updateMetronome();
        closeModal();
      }
    );

    el.modal.addEventListener(
      "click",
      (event) => {
        if (
          event.target === el.modal
        ) {
          closeModal();
        }
      }
    );

    el.reset.addEventListener(
      "click",
      resetApplication
    );

    el.start.addEventListener(
      "click",
      async () => {
        if (cameraRunning) {
          await stopCamera();
        } else {
          await startCamera();
        }
      }
    );

    el.bpm.addEventListener(
      "input",
      () => {
        el.bpmValue.textContent =
          `${el.bpm.value} BPM`;

        updateMetronome();
      }
    );

    el.metronome.addEventListener(
      "change",
      updateMetronome
    );

    el.camera.addEventListener(
      "change",
      async () => {
        savePreferences();

        if (cameraRunning) {
          await stopCamera(false);
          await startCamera();
        }
      }
    );

    window.addEventListener(
      "beforeinstallprompt",
      (event) => {
        event.preventDefault();

        deferredInstallPrompt =
          event;

        el.install.hidden = false;
      }
    );

    el.install.addEventListener(
      "click",
      async () => {
        if (
          !deferredInstallPrompt
        ) {
          return;
        }

        deferredInstallPrompt.prompt();

        deferredInstallPrompt =
          null;

        el.install.hidden = true;
      }
    );

    document.addEventListener(
      "visibilitychange",
      async () => {
        if (
          document.hidden &&
          cameraRunning
        ) {
          await stopCamera();
        } else if (
          !document.hidden
        ) {
          checkForAppUpdate();
        }
      }
    );
  }

  function activateWaitingWorker(
    registration
  ) {
    if (registration?.waiting) {
      registration.waiting
        .postMessage({
          type: "SKIP_WAITING"
        });
    }
  }

  async function checkForAppUpdate() {
    if (
      !serviceWorkerRegistration ||
      !navigator.onLine
    ) {
      return;
    }

    try {
      await serviceWorkerRegistration
        .update();

      activateWaitingWorker(
        serviceWorkerRegistration
      );
    } catch (error) {
      console.warn(
        "Semakan kemas kini gagal:",
        error
      );
    }
  }

  async function setupAutoUpdate() {
    if (
      !(
        "serviceWorker" in navigator
      )
    ) {
      return;
    }

    const hadController = Boolean(
      navigator.serviceWorker.controller
    );

    navigator.serviceWorker
      .addEventListener(
        "controllerchange",
        () => {
          if (
            !hadController ||
            reloadingForUpdate
          ) {
            return;
          }

          reloadingForUpdate = true;

          window.location.reload();
        }
      );

    serviceWorkerRegistration =
      await navigator.serviceWorker
        .register(
          "./sw.js",
          {
            updateViaCache: "none"
          }
        );

    serviceWorkerRegistration
      .addEventListener(
        "updatefound",
        () => {
          const worker =
            serviceWorkerRegistration
              .installing;

          if (!worker) return;

          worker.addEventListener(
            "statechange",
            () => {
              if (
                worker.state ===
                "installed"
              ) {
                activateWaitingWorker(
                  serviceWorkerRegistration
                );
              }
            }
          );
        }
      );

    activateWaitingWorker(
      serviceWorkerRegistration
    );

    await checkForAppUpdate();

    clearInterval(updateCheckId);

    updateCheckId = setInterval(
      checkForAppUpdate,
      UPDATE_CHECK_MS
    );
  }

  async function boot() {
    bindControls();
    loadPreferences();

    setupAutoUpdate().catch(
      (error) => {
        console.warn(
          "Kemas kini automatik:",
          error
        );
      }
    );

    await ensureModelReady();
    await listCameras();
  }

  boot().catch((error) => {
    console.error(
      "JumpXMan gagal dimulakan:",
      error
    );

    setStatus("RALAT", "error");

    showMessage(
      "⚠️ Aplikasi gagal dimulakan. Muat semula halaman.",
      true
    );
  });
})();