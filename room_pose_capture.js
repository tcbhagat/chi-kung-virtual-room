'use strict';

(function roomPoseCaptureModule(scope) {
  const TARGET_FRAME_MS = 1000 / 30;
  const CAMERA_RETRY_DELAYS = [0, 700, 1400];
  let pose;
  let stream;
  let running = false;
  let processing = false;
  let frameRequest = 0;
  let watchdog = 0;
  let lastSentAt = 0;
  let lastResultAt = 0;
  let frames = 0;

  function setStatus(message, active = false) {
    const label = document.getElementById('tracking-status');
    const dot = document.getElementById('tracking-dot');
    if (label) label.textContent = message;
    dot?.classList.toggle('connected', active);
  }

  function wait(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
  }

  function cameraErrorMessage(error) {
    if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') {
      return 'Camera blocked · allow it in Chrome site settings';
    }
    if (error?.name === 'NotFoundError' || error?.name === 'OverconstrainedError') {
      return 'Front camera not found · check Android camera access';
    }
    if (error?.name === 'NotReadableError' || error?.name === 'AbortError') {
      return 'Camera is busy · close other camera apps and retry';
    }
    return `Camera unavailable · ${error?.name || 'reload and retry'}`;
  }

  async function openCamera() {
    let lastError;
    for (const delay of CAMERA_RETRY_DELAYS) {
      if (delay) await wait(delay);
      try {
        const mediaStream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: 'user' },
            width: { ideal: 640 },
            height: { ideal: 480 },
            frameRate: { ideal: 30, max: 30 }
          }
        });
        const track = mediaStream.getVideoTracks()[0];
        if (!track || track.readyState !== 'live') throw new DOMException('No live video track', 'NotReadableError');
        return mediaStream;
      } catch (error) {
        lastError = error;
        const retryable = error?.name === 'NotReadableError' || error?.name === 'AbortError';
        if (!retryable) break;
      }
    }
    throw lastError || new Error('Camera could not start');
  }

  function onResults(results) {
    clearTimeout(watchdog);
    watchdog = 0;
    if (!results?.poseLandmarks) {
      setStatus('Camera active · step back until your full body is visible', true);
      return;
    }
    scope.QigongAvatarBridge?.updatePose(results.poseLandmarks);
    frames += 1;
    const now = performance.now();
    if (now - lastResultAt >= 1000) {
      setStatus(`Body tracked · ${frames} FPS`, true);
      frames = 0;
      lastResultAt = now;
    }
  }

  async function processFrame(now) {
    if (!running) return;
    frameRequest = requestAnimationFrame(processFrame);
    const video = document.getElementById('pose-input-video');
    if (!video || processing || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || now - lastSentAt < TARGET_FRAME_MS) return;

    processing = true;
    lastSentAt = now;
    try {
      await pose.send({ image: video });
    } catch (error) {
      console.error('Pose frame failed:', error);
      setStatus('Pose model stopped · reload while online');
      stop();
    } finally {
      processing = false;
    }
  }

  async function start() {
    if (running) return;
    if (!scope.isSecureContext && location.hostname !== 'localhost') {
      setStatus('Camera needs HTTPS');
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus('Camera API unavailable · update Chrome');
      return;
    }
    if (typeof scope.Pose !== 'function') {
      setStatus('Pose model failed to load · reload online');
      return;
    }

    const video = document.getElementById('pose-input-video');
    if (!video) return;
    setStatus('Opening front camera…');

    try {
      // Android may still be releasing the diagnostics stream. Direct acquisition
      // with retry avoids the Camera Utility's immediate second-open race.
      stream = await openCamera();
      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;
      await video.play();

      setStatus('Loading pose model…', true);
      pose = new scope.Pose({
        locateFile: file => `https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5.1675469404/${file}`
      });
      pose.setOptions({
        modelComplexity: 0,
        smoothLandmarks: true,
        enableSegmentation: false,
        minDetectionConfidence: 0.55,
        minTrackingConfidence: 0.55
      });
      pose.onResults(onResults);

      running = true;
      lastResultAt = performance.now();
      setStatus('Camera active · finding your body…', true);
      watchdog = setTimeout(() => {
        setStatus('Camera active · step back and improve lighting', true);
      }, 10000);
      frameRequest = requestAnimationFrame(processFrame);
    } catch (error) {
      console.error('Pose capture could not start:', error);
      stop();
      setStatus(cameraErrorMessage(error));
    }
  }

  function stop() {
    running = false;
    processing = false;
    cancelAnimationFrame(frameRequest);
    clearTimeout(watchdog);
    frameRequest = 0;
    watchdog = 0;
    stream?.getTracks().forEach(track => track.stop());
    stream = undefined;
    const video = document.getElementById('pose-input-video');
    if (video) video.srcObject = null;
    if (pose?.close) Promise.resolve(pose.close()).catch(() => {});
    pose = undefined;
  }

  scope.QigongRoomPoseCapture = { start, stop, get running() { return running; } };
  if (typeof module !== 'undefined' && module.exports) module.exports = scope.QigongRoomPoseCapture;
  if (typeof document !== 'undefined') {
    document.addEventListener('qigong-diagnostics-complete', () => setTimeout(start, 500));
    addEventListener('pagehide', stop);
  }
})(typeof window !== 'undefined' ? window : globalThis);
