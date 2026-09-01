'use strict';

(function roomPoseCaptureModule(scope) {
  let pose;
  let camera;
  let running = false;
  let lastResultAt = 0;
  let frames = 0;

  function setStatus(message, active = false) {
    const label = document.getElementById('tracking-status');
    const dot = document.getElementById('tracking-dot');
    if (label) label.textContent = message;
    dot?.classList.toggle('connected', active);
  }

  function onResults(results) {
    if (!results?.poseLandmarks) {
      setStatus('Step back so your full body is visible');
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

  async function start() {
    if (running) return;
    if (!scope.isSecureContext && location.hostname !== 'localhost') {
      setStatus('Camera needs HTTPS');
      return;
    }
    if (typeof scope.Pose !== 'function' || typeof scope.Camera !== 'function') {
      setStatus('Pose model failed to load · reload online');
      return;
    }

    const video = document.getElementById('pose-input-video');
    if (!video) return;
    setStatus('Loading pose model…');
    try {
      pose = new scope.Pose({
        locateFile: file => `https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5.1675469404/${file}`
      });
      pose.setOptions({
        modelComplexity: 0,
        smoothLandmarks: true,
        enableSegmentation: false,
        minDetectionConfidence: 0.6,
        minTrackingConfidence: 0.6
      });
      pose.onResults(onResults);
      camera = new scope.Camera(video, {
        onFrame: async () => pose.send({ image: video }),
        width: 640,
        height: 480
      });
      await camera.start();
      running = true;
      lastResultAt = performance.now();
      setStatus('Finding your body…');
    } catch (error) {
      console.error('Pose capture could not start:', error);
      stop();
      setStatus('Camera unavailable · check permission');
    }
  }

  function stop() {
    camera?.stop();
    document.getElementById('pose-input-video')?.srcObject?.getTracks().forEach(track => track.stop());
    running = false;
  }

  scope.QigongRoomPoseCapture = { start, stop, get running() { return running; } };
  if (typeof module !== 'undefined' && module.exports) module.exports = scope.QigongRoomPoseCapture;
  if (typeof document !== 'undefined') {
    document.addEventListener('qigong-diagnostics-complete', start);
    addEventListener('pagehide', stop);
  }
})(typeof window !== 'undefined' ? window : globalThis);
