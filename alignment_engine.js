'use strict';

(function alignmentModule(globalScope) {
  const LANDMARK = Object.freeze({
    LEFT_SHOULDER: 11, RIGHT_SHOULDER: 12,
    LEFT_HIP: 23, RIGHT_HIP: 24,
    LEFT_KNEE: 25, RIGHT_KNEE: 26,
    LEFT_ANKLE: 27, RIGHT_ANKLE: 28
  });

  const CONNECTIONS = Object.freeze([
    [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
    [11, 23], [12, 24], [23, 24], [23, 25], [25, 27],
    [24, 26], [26, 28], [27, 29], [29, 31], [28, 30], [30, 32]
  ]);

  const TRACKED_POINTS = Object.freeze([11, 12, 23, 24, 25, 26, 27, 28]);
  const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
  const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: ((a.z || 0) + (b.z || 0)) / 2 });
  const vector = (from, to) => ({ x: to.x - from.x, y: to.y - from.y, z: (to.z || 0) - (from.z || 0) });
  const magnitude = value => Math.hypot(value.x, value.y, value.z);

  function angle3D(a, vertex, c) {
    if (!a || !vertex || !c) return null;
    const first = vector(vertex, a);
    const second = vector(vertex, c);
    const denominator = magnitude(first) * magnitude(second);
    if (denominator < Number.EPSILON) return null;
    const cosine = clamp((first.x * second.x + first.y * second.y + first.z * second.z) / denominator, -1, 1);
    return Math.acos(cosine) * 180 / Math.PI;
  }

  function spineDeviation(landmarks) {
    if (!landmarks?.[LANDMARK.LEFT_SHOULDER] || !landmarks?.[LANDMARK.RIGHT_HIP]) return null;
    const shoulder = midpoint(landmarks[LANDMARK.LEFT_SHOULDER], landmarks[LANDMARK.RIGHT_SHOULDER]);
    const hip = midpoint(landmarks[LANDMARK.LEFT_HIP], landmarks[LANDMARK.RIGHT_HIP]);
    const spine = vector(shoulder, hip);
    const length = magnitude(spine);
    if (length < Number.EPSILON) return null;
    return Math.acos(clamp(Math.abs(spine.y) / length, -1, 1)) * 180 / Math.PI;
  }

  function classifySpine(angle) {
    if (!Number.isFinite(angle)) return { level: 'unknown', color: '#a9b4ae', label: 'Pose not visible' };
    if (angle < 5) return { level: 'good', color: '#32d583', label: 'Spine aligned' };
    if (angle <= 12) return { level: 'warning', color: '#fdb022', label: 'Gently return to centre' };
    return { level: 'poor', color: '#f04438', label: 'Straighten your spine slowly' };
  }

  function classifyKnee(angle) {
    if (!Number.isFinite(angle)) return { warning: true, label: 'not visible' };
    if (angle < 120) return { warning: true, label: 'stance too deep' };
    if (angle > 175) return { warning: true, label: 'knee may be locked' };
    return { warning: false, label: 'good' };
  }

  function confidenceScore(landmarks) {
    if (!landmarks?.length) return 0;
    const values = TRACKED_POINTS.map(index => landmarks[index]?.visibility ?? 0);
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  function analysePose(landmarks) {
    const spine = spineDeviation(landmarks);
    const leftKnee = angle3D(landmarks?.[23], landmarks?.[25], landmarks?.[27]);
    const rightKnee = angle3D(landmarks?.[24], landmarks?.[26], landmarks?.[28]);
    return {
      spine, leftKnee, rightKnee,
      spineStatus: classifySpine(spine),
      leftKneeStatus: classifyKnee(leftKnee),
      rightKneeStatus: classifyKnee(rightKnee),
      confidence: confidenceScore(landmarks)
    };
  }

  const api = { LANDMARK, angle3D, spineDeviation, classifySpine, classifyKnee, confidenceScore, analysePose };
  globalScope.QigongAlignment = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof document === 'undefined') return;

  const video = document.getElementById('input-video');
  const canvas = document.getElementById('pose-canvas');
  const context = canvas.getContext('2d');
  const toggle = document.getElementById('camera-toggle');
  const emptyState = document.getElementById('empty-state');
  const engineState = document.getElementById('engine-state');
  const feedback = document.getElementById('feedback-message');
  const hud = {
    fps: document.getElementById('hud-fps'), spine: document.getElementById('hud-spine'),
    leftKnee: document.getElementById('hud-left-knee'), rightKnee: document.getElementById('hud-right-knee'),
    confidence: document.getElementById('hud-confidence')
  };
  let pose;
  let camera;
  let running = false;
  let frameCount = 0;
  let fps = 0;
  let fpsWindowStart = performance.now();

  function formatAngle(value) {
    return Number.isFinite(value) ? `${value.toFixed(1)}°` : '—';
  }

  function setState(state, label) {
    engineState.dataset.state = state;
    engineState.textContent = label;
  }

  function resizeCanvas() {
    const width = video.videoWidth || 1280;
    const height = video.videoHeight || 720;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  }

  function drawPose(landmarks, color) {
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (!landmarks?.length) return;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.strokeStyle = color;
    context.lineWidth = Math.max(3, canvas.width / 220);
    context.shadowColor = 'rgba(0, 0, 0, .35)';
    context.shadowBlur = 4;
    for (const [start, end] of CONNECTIONS) {
      const a = landmarks[start];
      const b = landmarks[end];
      if (!a || !b || (a.visibility ?? 1) < 0.45 || (b.visibility ?? 1) < 0.45) continue;
      context.beginPath();
      context.moveTo(a.x * canvas.width, a.y * canvas.height);
      context.lineTo(b.x * canvas.width, b.y * canvas.height);
      context.stroke();
    }
    context.shadowBlur = 0;
    for (const landmark of landmarks) {
      if ((landmark.visibility ?? 1) < 0.45) continue;
      context.beginPath();
      context.arc(landmark.x * canvas.width, landmark.y * canvas.height, Math.max(3, canvas.width / 260), 0, Math.PI * 2);
      context.fillStyle = '#f7fff9';
      context.fill();
      context.strokeStyle = color;
      context.lineWidth = 2;
      context.stroke();
    }
  }

  function updateFeedback(metrics) {
    const warnings = [];
    if (metrics.leftKneeStatus.warning) warnings.push(`Left knee: ${metrics.leftKneeStatus.label}`);
    if (metrics.rightKneeStatus.warning) warnings.push(`Right knee: ${metrics.rightKneeStatus.label}`);
    feedback.textContent = warnings.length ? `${metrics.spineStatus.label} · ${warnings.join(' · ')}` : metrics.spineStatus.label;
    feedback.dataset.level = metrics.spineStatus.level;
  }

  function onResults(results) {
    resizeCanvas();
    frameCount += 1;
    const now = performance.now();
    if (now - fpsWindowStart >= 1000) {
      fps = frameCount * 1000 / (now - fpsWindowStart);
      frameCount = 0;
      fpsWindowStart = now;
    }
    const imageLandmarks = results.poseLandmarks;
    const calculationLandmarks = results.poseWorldLandmarks?.length ? results.poseWorldLandmarks : imageLandmarks;
    if (!imageLandmarks?.length) {
      context.clearRect(0, 0, canvas.width, canvas.height);
      feedback.textContent = 'Move back until your full body is visible';
      feedback.dataset.level = 'warning';
      hud.fps.textContent = fps ? fps.toFixed(0) : '—';
      hud.spine.textContent = hud.leftKnee.textContent = hud.rightKnee.textContent = hud.confidence.textContent = '—';
      return;
    }
    const metrics = analysePose(calculationLandmarks);
    drawPose(imageLandmarks, metrics.spineStatus.color);
    hud.fps.textContent = fps ? fps.toFixed(0) : '—';
    hud.spine.textContent = formatAngle(metrics.spine);
    hud.leftKnee.textContent = formatAngle(metrics.leftKnee);
    hud.rightKnee.textContent = formatAngle(metrics.rightKnee);
    hud.confidence.textContent = `${Math.round(metrics.confidence * 100)}%`;
    updateFeedback(metrics);
  }

  async function startCamera() {
    if (!window.isSecureContext && location.hostname !== 'localhost') {
      throw new Error('Camera access requires HTTPS or localhost.');
    }
    if (typeof Pose !== 'function' || typeof Camera !== 'function') {
      throw new Error('MediaPipe could not load. Check your internet connection and reload.');
    }
    setState('loading', 'Loading model');
    toggle.disabled = true;
    pose = new Pose({
      locateFile: file => `https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5.1675469404/${file}`
    });
    pose.setOptions({
      modelComplexity: 1, smoothLandmarks: true, enableSegmentation: false,
      minDetectionConfidence: 0.6, minTrackingConfidence: 0.6
    });
    pose.onResults(onResults);
    camera = new Camera(video, {
      onFrame: async () => pose.send({ image: video }), width: 1280, height: 720
    });
    await camera.start();
    running = true;
    emptyState.hidden = true;
    toggle.textContent = 'Stop camera';
    toggle.disabled = false;
    setState('active', 'Tracking');
    feedback.textContent = 'Finding your pose…';
  }

  function stopCamera() {
    camera?.stop();
    video.srcObject?.getTracks().forEach(track => track.stop());
    context.clearRect(0, 0, canvas.width, canvas.height);
    running = false;
    emptyState.hidden = false;
    toggle.textContent = 'Start camera';
    setState('idle', 'Ready');
    feedback.textContent = 'Camera is off';
    feedback.dataset.level = '';
  }

  toggle.addEventListener('click', async () => {
    if (running) {
      stopCamera();
      return;
    }
    try {
      await startCamera();
    } catch (error) {
      console.error(error);
      stopCamera();
      setState('error', 'Camera error');
      feedback.textContent = error.message;
      feedback.dataset.level = 'poor';
      toggle.disabled = false;
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
