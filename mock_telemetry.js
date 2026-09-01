'use strict';

const FPS = 30;
const FRAME_MS = 1000 / FPS;

// Neutral, front-facing normalized pose in MediaPipe landmark order.
const BASE_POSE = [
  [.50, .16, -.08], [.48, .15, -.08], [.47, .15, -.08], [.46, .15, -.07],
  [.52, .15, -.08], [.53, .15, -.08], [.54, .15, -.07], [.43, .17, -.04],
  [.57, .17, -.04], [.48, .20, -.07], [.52, .20, -.07], [.40, .30, 0],
  [.60, .30, 0], [.35, .43, -.01], [.65, .43, -.01], [.32, .56, -.02],
  [.68, .56, -.02], [.30, .58, -.02], [.70, .58, -.02], [.31, .57, -.03],
  [.69, .57, -.03], [.33, .55, -.03], [.67, .55, -.03], [.45, .55, 0],
  [.55, .55, 0], [.44, .72, .01], [.56, .72, .01], [.43, .89, .02],
  [.57, .89, .02], [.42, .92, .01], [.58, .92, .01], [.44, .95, -.04],
  [.56, .95, -.04]
];

const round = (value, places = 4) => Number(value.toFixed(places));

function createFrame(sequence = 0, capturedAt = Date.now()) {
  const seconds = sequence / FPS;
  const breath = Math.sin(2 * Math.PI * seconds / 5); // Five-second breathing cycle.
  const sway = Math.sin(2 * Math.PI * seconds / 8);   // Slow lateral weight shift.

  return {
    s: sequence,
    t: capturedAt,
    p: BASE_POSE.map(([x, y, z], index) => {
      const upperBody = index <= 22 ? 1 : 0.3;
      const handLift = index >= 13 && index <= 22 ? 0.004 * breath : 0;
      const noise = 0.0008 * Math.sin(sequence * 0.17 + index);
      return [
        round(x + 0.006 * sway + noise),
        round(y - 0.008 * breath * upperBody - handLift + noise),
        round(z - 0.006 * breath * upperBody),
        round(0.97 - 0.015 * Math.abs(sway), 3)
      ];
    })
  };
}

function startStream(onFrame, fps = FPS) {
  if (typeof onFrame !== 'function') throw new TypeError('onFrame must be a function');
  const intervalMs = 1000 / fps;
  let sequence = 0;
  let nextAt = performance.now();
  let timer;

  const tick = () => {
    onFrame(createFrame(sequence++, Date.now()));
    nextAt += intervalMs;
    timer = setTimeout(tick, Math.max(0, nextAt - performance.now()));
  };

  timer = setTimeout(tick, 0);
  return () => clearTimeout(timer);
}

if (require.main === module) {
  startStream(frame => process.stdout.write(`${JSON.stringify(frame)}\n`));
}

module.exports = { BASE_POSE, FPS, FRAME_MS, createFrame, startStream };
