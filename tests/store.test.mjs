/**
 * Reconciliation between the local cache and a portal's save slot.
 *
 * CrazyGames says plainly that their Automatic Progress Save does not work for iframe
 * games, so plain localStorage there is not actually backed up: it is the tab's own
 * scratch space, gone the moment the player clears it or switches device. Their Data
 * Module is the real save. `resyncProgress()` is what keeps the two from silently
 * diverging, so its merge rule is worth pinning directly rather than trusting by eye.
 *
 * A fake CrazyGames SDK is installed before anything is imported, mirroring
 * localStorage exactly as their Data Module docs describe, backed by a Map this file
 * holds onto directly so it can simulate "a save already sitting in the cloud".
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

const cloud = new Map();
const localBacking = new Map();

globalThis.window = {
  CrazyGames: {
    SDK: {
      init: async () => {},
      game: { loadingStart() {}, loadingStop() {}, gameplayStart() {}, gameplayStop() {} },
      ad: { requestAd() {} },
      data: {
        getItem: (k) => (cloud.has(k) ? cloud.get(k) : null),
        setItem: (k, v) => cloud.set(k, v),
        removeItem: (k) => cloud.delete(k),
      },
    },
  },
};
globalThis.document = {
  createElement: () => ({ tagName: 'SCRIPT', set src(v) { this._src = v; }, get src() { return this._src; } }),
  head: { append(tag) { setTimeout(() => tag.onload?.(), 0); } },
};
// A controllable localStorage standing in for "this device's tab", independent of
// the cloud Map above, so a device with an empty local cache can be simulated by
// clearing it without needing a second module instance.
globalThis.localStorage = {
  setItem: (k, v) => localBacking.set(k, v),
  getItem: (k) => (localBacking.has(k) ? localBacking.get(k) : null),
  removeItem: (k) => localBacking.delete(k),
};

const platform = await import('../poki-ready-copy/game/platform.js');
const store = await import('../poki-ready-copy/game/store.js');

await platform.initPlatform();
assert.ok(platform.dataModule(), 'the fake SDK must be recognised, or every test below is meaningless');

const KEY = 'nodal.progress.v1';
const progressWith = (stars) => ({ stars, capstone: null });

test('local progress with an empty cloud pushes up rather than being discarded', () => {
  cloud.clear();
  localBacking.clear();
  store.saveProgress(progressWith({ 'a.0': 3 }));

  const result = store.resyncProgress();
  assert.deepEqual(result, progressWith({ 'a.0': 3 }));
  assert.deepEqual(JSON.parse(cloud.get(KEY)).stars, { 'a.0': 3 }, 'the cloud copy must now match');
});

test('a returning player on an empty device pulls their progress down from the cloud', () => {
  cloud.set(KEY, JSON.stringify(progressWith({ 'a.0': 3, 'a.1': 2 })));
  localBacking.clear(); // simulates a fresh device with nothing cached locally

  assert.deepEqual(store.loadProgress().stars, {}, 'the local cache alone must not see the cloud yet');
  const result = store.resyncProgress();
  assert.deepEqual(result.stars, { 'a.0': 3, 'a.1': 2 });
  assert.deepEqual(
    store.loadProgress().stars,
    { 'a.0': 3, 'a.1': 2 },
    'resync must also update the local cache, or the next load would regress it',
  );
});

test('two non-empty copies: the cloud wins, since it is the one meant to survive', () => {
  cloud.clear();
  localBacking.clear();
  cloud.set(KEY, JSON.stringify(progressWith({ 'a.0': 3 })));
  // Written straight to the local backing, bypassing saveProgress(), which would also
  // push to the cloud and defeat the point of this test: a local copy that diverged
  // from the cloud without a sync in between, e.g. progress made while offline.
  localBacking.set(KEY, JSON.stringify(progressWith({ 'b.0': 1 })));

  const result = store.resyncProgress();
  assert.deepEqual(result.stars, { 'a.0': 3 }, 'the cloud copy must be preferred over a differing local one');
});

test('both empty: nothing to reconcile, and nothing is written', () => {
  cloud.clear();
  localBacking.clear();
  assert.equal(store.resyncProgress(), null);
  assert.equal(cloud.has(KEY), false);
});

test('isPersistent is true whenever either the device or the portal can keep progress', () => {
  assert.equal(store.isPersistent(), true, 'the fake Data Module is available in this file');
});
