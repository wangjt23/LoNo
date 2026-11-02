import test from 'node:test';
import assert from 'node:assert/strict';
import { registerCaptureKeys, captureKeys } from '../src/core/shortcuts.js';

test('registers both keys and exposes a working fallback on primary conflict', () => {
  const attempted = [];
  const fake = { isRegistered: () => false, register: (key, callback) => { attempted.push({ key, callback }); return key.includes('Alt'); } };
  const callback = () => {};
  const result = registerCaptureKeys(fake, callback, 'win32');
  assert.equal(result.active, 'Ctrl+Alt+Space');
  assert.equal(result.keys[0].registered, false); assert.equal(result.keys[1].registered, true);
  assert.equal(attempted.length, 2); assert.equal(attempted[1].callback, callback);
});

test('macOS exposes Command and Option labels while registering native accelerators', () => {
  const attempted = [];
  const fake = { isRegistered: () => false, register: key => { attempted.push(key); return key.includes('Alt'); } };
  const result = registerCaptureKeys(fake, () => {}, 'darwin');
  assert.equal(result.keys[0].label, 'Command+Shift+Space');
  assert.equal(result.active, 'Command+Option+Space');
  assert.deepEqual(attempted, captureKeys.map(key => key.accelerator));
});
test('reports total conflict and replaces only this app’s existing bindings on retry', () => {
  const registered = new Set([captureKeys[0].accelerator, 'Control+X']);
  const fake = { isRegistered: key => registered.has(key), unregister: key => registered.delete(key), register: () => false };
  assert.equal(registerCaptureKeys(fake, () => {}).active, null);
  assert.equal(registered.has('Control+X'), true);
  assert.equal(registered.has(captureKeys[0].accelerator), false);
});
