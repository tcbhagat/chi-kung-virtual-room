'use strict';

(function diagnosticsModule(scope) {
  const state = { results: [], signalingUrl: '', completedAt: null };
  const escapeHtml = value => String(value).replace(/[&<>"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[character]);

  function getSignalingUrl() {
    const queryValue = new URLSearchParams(location.search).get('server');
    let storedValue = '';
    try { storedValue = localStorage.getItem('qigong:signaling-url') || ''; } catch { /* Storage may be disabled. */ }
    const candidate = queryValue || scope.QIGONG_SIGNALING_URL || storedValue || location.origin;
    try {
      const url = new URL(candidate, location.href);
      if (!/^https?:$/.test(url.protocol)) throw new Error('Unsupported protocol');
      const normalized = url.origin;
      if (queryValue) {
        try { localStorage.setItem('qigong:signaling-url', normalized); } catch { /* Non-critical. */ }
      }
      return normalized;
    } catch {
      return location.origin;
    }
  }

  function result(id, name, passed, detail, tip, optional = false) {
    return { id, name, passed: Boolean(passed), detail, tip, optional };
  }

  async function testWebGL2() {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('webgl2', { failIfMajorPerformanceCaveat: true });
    return result('webgl2', 'WebGL 2.0', Boolean(context), context ? 'Hardware-accelerated 3D is available.' : 'WebGL 2.0 could not start.', 'Enable hardware acceleration or update Chrome/Edge.');
  }

  async function testCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
      return result('camera', 'Webcam', false, 'This browser cannot request a camera.', 'Use current Chrome, Edge or Safari over HTTPS.');
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' }
      });
      const settings = stream.getVideoTracks()[0]?.getSettings() || {};
      const width = settings.width || 0;
      const height = settings.height || 0;
      const adequate = width >= 640 && height >= 480;
      return result('camera', 'Webcam', adequate, `${width || '?'} × ${height || '?'} camera stream detected.`, adequate ? 'Keep your full body visible in good light.' : 'Select a camera capable of at least 640 × 480.');
    } catch (error) {
      const blocked = error?.name === 'NotAllowedError' || error?.name === 'SecurityError';
      return result('camera', 'Webcam', false, blocked ? 'Camera permission is blocked.' : `Camera unavailable (${error?.name || 'unknown error'}).`, blocked ? 'Open browser Site settings, allow Camera, then run the tests again.' : 'Connect or enable a webcam, then retry.');
    } finally {
      stream?.getTracks().forEach(track => track.stop());
    }
  }

  async function testWebXR() {
    if (!navigator.xr) {
      return result('webxr', 'WebXR', false, 'WebXR API is unavailable; desktop mode can still run.', 'For headset mode use a WebXR-compatible browser over HTTPS.', true);
    }
    try {
      const immersive = await navigator.xr.isSessionSupported('immersive-vr');
      return result('webxr', 'WebXR', true, immersive ? 'Immersive VR session is supported.' : 'Browser supports WebXR; no active VR session was found.', immersive ? 'Headset mode is ready.' : 'Connect a compatible headset, or continue in desktop mode.', true);
    } catch {
      return result('webxr', 'WebXR', true, 'WebXR API detected; headset capability could not be confirmed.', 'Desktop mode remains available.', true);
    }
  }

  async function testSignaling(signalingUrl) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    const startedAt = performance.now();
    try {
      const response = await fetch(`${signalingUrl}/health`, { cache: 'no-store', credentials: 'omit', signal: controller.signal });
      const elapsed = performance.now() - startedAt;
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return result('signaling', 'Room server', true, `Reachable in ${elapsed.toFixed(0)} ms.`, 'Connection is ready.');
    } catch (error) {
      const staticHost = /github\.io$|netlify\.app$/.test(location.hostname);
      const tip = staticHost && signalingUrl === location.origin
        ? 'Use the tester link supplied by the organizer with ?server=https://SIGNALING-SERVER.'
        : 'Check the server address, HTTPS certificate and internet connection.';
      return result('signaling', 'Room server', false, `No response from ${signalingUrl}.`, tip);
    } finally {
      clearTimeout(timeout);
    }
  }

  function ensureModal() {
    if (document.getElementById('diagnostics-modal')) return;
    const style = document.createElement('style');
    style.textContent = `
      .diag-backdrop{position:fixed;z-index:10000;inset:0;display:grid;place-items:center;padding:18px;background:rgba(2,13,10,.82);backdrop-filter:blur(10px)}
      .diag-card{width:min(560px,100%);max-height:calc(100vh - 36px);overflow:auto;padding:22px;border:1px solid rgba(255,255,255,.18);border-radius:20px;background:#0b2119;color:#effff8;box-shadow:0 30px 90px rgba(0,0,0,.45);font-family:Inter,system-ui,sans-serif}
      .diag-card h2{margin:0 0 6px;font-size:1.35rem}.diag-intro{margin:0 0 16px;color:#a8c8ba;font-size:.86rem;line-height:1.5}
      .diag-list{display:grid;gap:9px}.diag-row{display:grid;grid-template-columns:auto 1fr;gap:10px;padding:11px;border-radius:12px;background:rgba(255,255,255,.045)}
      .diag-badge{align-self:start;min-width:48px;padding:4px 7px;border-radius:999px;text-align:center;font-size:.67rem;font-weight:800}.diag-badge.pass{color:#062516;background:#32d583}.diag-badge.fail{color:#310806;background:#ff8b84}
      .diag-copy strong{display:block;font-size:.85rem}.diag-copy span,.diag-copy small{display:block;margin-top:2px;color:#b8d1c5;font-size:.74rem;line-height:1.35}.diag-copy small{color:#f3ce83}
      .diag-actions{display:flex;gap:10px;margin-top:17px}.diag-actions button{flex:1;padding:11px 13px;border:0;border-radius:11px;font:700 .84rem Inter,system-ui;cursor:pointer}.diag-retry{background:#29473b;color:#eafff4}.diag-continue{background:#32d583;color:#042015}.diag-summary{margin:14px 0 0;font-size:.78rem;font-weight:700}
    `;
    document.head.appendChild(style);
    const modal = document.createElement('div');
    modal.id = 'diagnostics-modal';
    modal.className = 'diag-backdrop';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'diagnostics-title');
    modal.innerHTML = `<section class="diag-card"><h2 id="diagnostics-title">Device readiness check</h2><p class="diag-intro">Allow camera access when asked. Video is checked locally and is not uploaded.</p><div id="diagnostics-results" class="diag-list"><p>Running tests…</p></div><p id="diagnostics-summary" class="diag-summary"></p><div class="diag-actions"><button id="diagnostics-retry" class="diag-retry" type="button">Run again</button><button id="diagnostics-continue" class="diag-continue" type="button">Continue to room</button></div></section>`;
    document.body.appendChild(modal);
    document.getElementById('diagnostics-retry').addEventListener('click', run);
    document.getElementById('diagnostics-continue').addEventListener('click', continueToRoom);
  }

  function renderResults() {
    const container = document.getElementById('diagnostics-results');
    const criticalFailures = state.results.filter(item => !item.optional && !item.passed);
    container.innerHTML = state.results.map(item => `<div class="diag-row"><span class="diag-badge ${item.passed ? 'pass' : 'fail'}">${item.passed ? 'PASS' : 'FAIL'}</span><div class="diag-copy"><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.detail)}</span><small>${escapeHtml(item.tip)}</small></div></div>`).join('');
    document.getElementById('diagnostics-summary').textContent = criticalFailures.length ? `${criticalFailures.length} essential check${criticalFailures.length === 1 ? '' : 's'} need attention. You may continue for troubleshooting.` : 'Essential checks passed. You are ready to enter.';
    document.getElementById('diagnostics-continue').disabled = false;
  }

  async function run() {
    ensureModal();
    const resultsElement = document.getElementById('diagnostics-results');
    resultsElement.innerHTML = '<p>Running tests…</p>';
    document.getElementById('diagnostics-continue').disabled = true;
    state.signalingUrl = getSignalingUrl();
    const [webgl2, camera, webxr, signaling] = await Promise.all([
      testWebGL2(), testCamera(), testWebXR(), testSignaling(state.signalingUrl)
    ]);
    state.results = [webgl2, camera, webxr, signaling];
    state.completedAt = new Date().toISOString();
    renderResults();
    document.dispatchEvent(new CustomEvent('qigong-diagnostics-results', { detail: { ...state } }));
    return state.results;
  }

  function continueToRoom() {
    const scene = document.querySelector('a-scene');
    if (scene) {
      scene.setAttribute('networked-scene', 'serverURL', state.signalingUrl || getSignalingUrl());
      if (!scope.NAF?.connection?.isConnected()) scene.emit('connect');
    }
    document.getElementById('diagnostics-modal')?.remove();
    document.dispatchEvent(new CustomEvent('qigong-diagnostics-complete', { detail: { ...state } }));
  }

  const api = { state, run, continueToRoom, getSignalingUrl, testWebGL2, testCamera, testWebXR, testSignaling };
  scope.QigongDiagnostics = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run, { once: true });
    else run();
  }
})(typeof window !== 'undefined' ? window : globalThis);
