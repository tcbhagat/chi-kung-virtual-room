'use strict';

(function avatarBridgeModule(scope) {
  const POSE_INDEX = Object.freeze({ HEAD: 0, LEFT_HAND: 15, RIGHT_HAND: 16, LEFT_SHOULDER: 11, RIGHT_SHOULDER: 12, LEFT_HIP: 23, RIGHT_HIP: 24 });
  const OUTBOUND_FPS = 15;
  const DEFAULT_TARGETS = Object.freeze({
    head: { x: 0, y: 1.65, z: 0 },
    leftHand: { x: -0.42, y: 1.1, z: 0 },
    rightHand: { x: 0.42, y: 1.1, z: 0 },
    torso: { x: 0, y: 1.05, z: 0 },
    torsoScale: { x: 1, y: 1, z: 1 }
  });

  const toPoint = value => Array.isArray(value)
    ? { x: value[0], y: value[1], z: value[2] || 0, visibility: value[3] ?? 1 }
    : value;
  const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: ((a.z || 0) + (b.z || 0)) / 2 });
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0));
  const finitePoint = point => point && [point.x, point.y, point.z || 0].every(Number.isFinite);
  const roundPoint = point => ({ x: +point.x.toFixed(4), y: +point.y.toFixed(4), z: +point.z.toFixed(4) });

  function mapPoseToAvatar(input) {
    const landmarks = input?.p || input?.landmarks || input;
    if (!Array.isArray(landmarks) || landmarks.length < 29) return null;
    const point = index => toPoint(landmarks[index]);
    const head = point(POSE_INDEX.HEAD);
    const leftHand = point(POSE_INDEX.LEFT_HAND);
    const rightHand = point(POSE_INDEX.RIGHT_HAND);
    const leftShoulder = point(POSE_INDEX.LEFT_SHOULDER);
    const rightShoulder = point(POSE_INDEX.RIGHT_SHOULDER);
    const leftHip = point(POSE_INDEX.LEFT_HIP);
    const rightHip = point(POSE_INDEX.RIGHT_HIP);
    if (![head, leftHand, rightHand, leftShoulder, rightShoulder, leftHip, rightHip].every(finitePoint)) return null;

    const hip = midpoint(leftHip, rightHip);
    const shoulder = midpoint(leftShoulder, rightShoulder);
    const mapPoint = source => roundPoint({
      x: (source.x - hip.x) * 2.2,
      y: 1 + (hip.y - source.y) * 2.2,
      z: -(source.z - hip.z) * 1.2
    });
    const shoulderWidth = Math.max(0.12, distance(leftShoulder, rightShoulder));
    const torsoLength = Math.max(0.12, distance(shoulder, hip));
    return {
      head: mapPoint(head), leftHand: mapPoint(leftHand), rightHand: mapPoint(rightHand),
      torso: mapPoint(midpoint(shoulder, hip)),
      torsoScale: roundPoint({
        x: Math.min(1.65, Math.max(0.65, shoulderWidth / 0.22)),
        y: Math.min(1.45, Math.max(0.65, torsoLength / 0.25)),
        z: 1
      })
    };
  }

  const api = {
    OUTBOUND_FPS, POSE_INDEX, mapPoseToAvatar,
    updatePose(pose) {
      const targets = mapPoseToAvatar(pose);
      const player = typeof document !== 'undefined' && document.getElementById('player');
      if (!targets || !player) return false;
      player.setAttribute('pose-packet', targets);
      return true;
    }
  };
  scope.QigongAvatarBridge = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof AFRAME === 'undefined' || typeof NAF === 'undefined') return;

  // Local pose-packet can update at camera/render speed; NAF samples it at 15 Hz.
  NAF.options.updateRate = OUTBOUND_FPS;
  NAF.options.useLerp = true; // Smooth root locomotion; joint interpolation is handled below.

  AFRAME.registerComponent('pose-packet', {
    schema: {
      head: { type: 'vec3', default: DEFAULT_TARGETS.head },
      leftHand: { type: 'vec3', default: DEFAULT_TARGETS.leftHand },
      rightHand: { type: 'vec3', default: DEFAULT_TARGETS.rightHand },
      torso: { type: 'vec3', default: DEFAULT_TARGETS.torso },
      torsoScale: { type: 'vec3', default: DEFAULT_TARGETS.torsoScale }
    }
  });

  AFRAME.registerComponent('avatar-bridge', {
    schema: { smoothing: { default: 12, min: 1, max: 30 } },
    init() {
      this.head = this.el.querySelector('.avatar-head');
      this.leftHand = this.el.querySelector('.avatar-left-hand');
      this.rightHand = this.el.querySelector('.avatar-right-hand');
      this.torso = this.el.querySelector('.avatar-torso');
      this.isLocal = this.el.hasAttribute('data-local-avatar');
      // A local head mesh encloses the camera, so it should only be visible remotely.
      if (this.isLocal && this.head) this.head.object3D.visible = false;
    },
    tick(time, deltaMs) {
      const packet = this.el.getAttribute('pose-packet');
      if (!packet || !this.head || !this.torso) return;
      const alpha = this.isLocal ? 1 : 1 - Math.exp(-this.data.smoothing * Math.min(deltaMs, 100) / 1000);
      this.head.object3D.position.lerp(packet.head, alpha);
      this.leftHand.object3D.position.lerp(packet.leftHand, alpha);
      this.rightHand.object3D.position.lerp(packet.rightHand, alpha);
      this.torso.object3D.position.lerp(packet.torso, alpha);
      this.torso.object3D.scale.lerp(packet.torsoScale, alpha);
    }
  });

  NAF.schemas.add({
    template: '#avatar-template',
    components: ['position', 'rotation', 'pose-packet']
  });

  document.addEventListener('qigong-pose', event => api.updatePose(event.detail?.landmarks || event.detail));
  function refreshParticipantCount() {
    if (!NAF.connection?.isConnected()) return;
    const count = Object.keys(NAF.connection.getConnectedClients() || {}).length + 1;
    const label = document.getElementById('network-status');
    if (label) label.textContent = `Connected · ${count} participant${count === 1 ? '' : 's'}`;
  }

  function setupNetworkHud() {
    document.body.addEventListener('connected', () => {
      const dot = document.getElementById('status-dot');
      dot?.classList.add('connected');
      refreshParticipantCount();
    });
    document.body.addEventListener('clientConnected', refreshParticipantCount);
    document.body.addEventListener('clientDisconnected', refreshParticipantCount);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setupNetworkHud, { once: true });
  else setupNetworkHud();
})(typeof window !== 'undefined' ? window : globalThis);
