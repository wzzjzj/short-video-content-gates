import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

// Emit styles only: no project writes, dependency installs or publication checks.
const zones = JSON.parse(readFileSync(new URL('../references/douyin-1080x1920-safe-zones.json', import.meta.url), 'utf8'));
const { x, y, width, height } = zones.core;
assert.ok([x, y, width, height].every(Number.isFinite));
assert.ok(x >= 0 && y >= 0 && width > 0 && height > 0);
assert.ok(x + width <= zones.canvas.width && y + height <= zones.canvas.height);
const contains = r => r.x >= x && r.y >= y && r.x + r.width <= x + width && r.y + r.height <= y + height;
if (process.argv.includes('--self-test')) {
  assert.ok(contains(zones.core));
  assert.ok(!contains({ x, y: y - 1, width: 10, height: 10 }));
  assert.ok(!contains({ x: x + width - 9, y, width: 10, height: 10 }));
  assert.ok(!contains({ x, y: y + height - 9, width: 10, height: 10 }));
  assert.ok(!contains({ x: x - 1, y, width: 10, height: 10 }));
  console.log('Safe geometry self-test passed; rendered text and motion still require visual review.');
} else {
  console.log(`.platform-safe-content {
  position: absolute;
  left: ${x}px;
  top: ${y}px;
  width: ${width}px;
  height: ${height}px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: visible;
}
.platform-safe-content > * { max-width: 100%; box-sizing: border-box; }`);
}
