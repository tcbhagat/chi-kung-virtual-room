'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const destination = path.join(root, 'dist');
const files = [
  'index.html', 'styles.css', 'alignment_engine.js',
  'room.html', 'avatar_bridge.js', 'room_pose_capture.js', 'diagnostics.js', 'telemetry_logger.js',
  'pose_schema.json'
];

if (path.dirname(destination) !== root || path.basename(destination) !== 'dist') {
  throw new Error('Refusing to build outside the project dist directory');
}
fs.rmSync(destination, { recursive: true, force: true });
fs.mkdirSync(destination, { recursive: true });
for (const file of files) {
  const source = path.join(root, file);
  if (!fs.existsSync(source)) throw new Error(`Missing static asset: ${file}`);
  fs.copyFileSync(source, path.join(destination, file));
}
fs.writeFileSync(path.join(destination, '.nojekyll'), '');
console.log(`Static package ready: ${files.length} files in dist/`);
