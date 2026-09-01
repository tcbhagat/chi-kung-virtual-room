'use strict';

(function telemetryModule(scope) {
  const STORAGE_KEY = 'qigong:last-session-report';
  const startedAt = performance.now();
  const counters = { frames: 0, activeRenderMs: 0, pingsSent: 0, pingsMissed: 0, pingRtts: [] };
  let lastFrameAt = performance.now();
  let heartbeatTimer;
  let socket;

  function animationFrame(now) {
    const delta = now - lastFrameAt;
    if (!document.hidden && delta > 0 && delta < 1000) {
      counters.frames += 1;
      counters.activeRenderMs += delta;
    }
    lastFrameAt = now;
    requestAnimationFrame(animationFrame);
  }

  function average(values) {
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  }

  function getReport() {
    const durationSeconds = Math.max(0, (performance.now() - startedAt) / 1000);
    const packetLoss = counters.pingsSent ? counters.pingsMissed / counters.pingsSent * 100 : 0;
    return {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      privacy: 'Anonymous performance data stored locally; no video or pose coordinates included.',
      performance: {
        averageFps: +(counters.activeRenderMs ? counters.frames / (counters.activeRenderMs / 1000) : 0).toFixed(2),
        packetLossPercent: +packetLoss.toFixed(2),
        averagePingMs: +average(counters.pingRtts).toFixed(2),
        sessionDurationSeconds: +durationSeconds.toFixed(1),
        heartbeatSamples: counters.pingsSent
      },
      diagnostics: scope.QigongDiagnostics?.state?.results || []
    };
  }

  function saveLocal() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(getReport())); } catch { /* Storage is optional. */ }
  }

  function sendHeartbeat() {
    if (!socket?.connected) {
      counters.pingsSent += 1;
      counters.pingsMissed += 1;
      return;
    }
    counters.pingsSent += 1;
    const sentAt = performance.now();
    socket.timeout(1500).emit('telemetry:ping', { t: Date.now() }, error => {
      if (error) counters.pingsMissed += 1;
      else counters.pingRtts.push(performance.now() - sentAt);
    });
  }

  function startNetworkSampling() {
    socket = scope.NAF?.connection?.adapter?.socket;
    if (!socket || heartbeatTimer) return;
    sendHeartbeat();
    heartbeatTimer = setInterval(sendHeartbeat, 2000);
  }

  function downloadReport() {
    const blob = new Blob([`${JSON.stringify(getReport(), null, 2)}\n`], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'session_report.json';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function setup() {
    requestAnimationFrame(animationFrame);
    const button = document.getElementById('download-test-report');
    button?.addEventListener('click', downloadReport);
    document.body.addEventListener('connected', startNetworkSampling);
    setInterval(saveLocal, 10000);
    addEventListener('pagehide', saveLocal);
  }

  const api = { getReport, downloadReport, saveLocal, counters };
  scope.QigongTelemetry = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup, { once: true });
    else setup();
  }
})(typeof window !== 'undefined' ? window : globalThis);
