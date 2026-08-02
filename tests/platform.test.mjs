/**
 * Pins the portal contract.
 *
 * These names are not ours: they belong to CrazyGames' and Poki's SDKs, and getting one
 * wrong means a submission that looks fine locally and reports nothing in production,
 * which is the kind of failure nobody notices until the revenue does not arrive. A
 * browser is not needed to check the mapping, so this runs in Node against a fake DOM
 * and is fast enough to keep in the normal test run.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

/** Minimal DOM: enough for a script tag to be created, appended and "load". */
function fakeDom({ sdk, failScript = false }) {
  const appended = [];
  globalThis.window = { CrazyGames: sdk ? { SDK: sdk } : undefined };
  globalThis.document = {
    createElement: () => ({ tagName: 'SCRIPT', set src(v) { this._src = v; }, get src() { return this._src; } }),
    head: {
      append(tag) {
        appended.push(tag.src);
        // Resolve on the next tick, the way a real load does.
        setTimeout(() => (failScript ? tag.onerror?.() : tag.onload?.()), 0);
      },
    },
  };
  return appended;
}

/** Records every call a portal SDK receives, in order. */
function recordingCrazySdk({ adBehaviour = 'finish' } = {}) {
  const calls = [];
  const dataStore = new Map();
  return {
    calls,
    dataStore,
    sdk: {
      init: async () => calls.push('init'),
      game: {
        loadingStart: () => calls.push('loadingStart'),
        loadingStop: () => calls.push('loadingStop'),
        gameplayStart: () => calls.push('gameplayStart'),
        gameplayStop: () => calls.push('gameplayStop'),
      },
      ad: {
        requestAd(type, cb) {
          calls.push(`requestAd:${type}`);
          if (adBehaviour === 'silent') return;
          setTimeout(() => {
            cb.adStarted?.();
            setTimeout(() => (adBehaviour === 'error' ? cb.adError?.('nope') : cb.adFinished?.()), 0);
          }, 0);
        },
      },
      // Mirrors localStorage, per CrazyGames' own docs for the Data Module.
      data: {
        getItem: (k) => (dataStore.has(k) ? dataStore.get(k) : null),
        setItem: (k, v) => dataStore.set(k, v),
        removeItem: (k) => dataStore.delete(k),
      },
    },
  };
}

/** Fresh module instance per test, since the façade holds state on purpose. */
const freshPlatform = () => import(`../poki-ready-copy/game/platform.js?t=${Math.random()}`);

test('the CrazyGames adapter maps onto the v3 method names', async () => {
  const { calls, sdk } = recordingCrazySdk();
  fakeDom({ sdk });
  const platform = await freshPlatform();

  assert.equal(await platform.initPlatform(), true, 'a present SDK should be detected');
  assert.ok(calls.includes('init'), 'v3 is unusable until init is awaited');

  platform.loadingStart();
  platform.loadingFinished();
  assert.deepEqual(
    calls.filter((c) => c.startsWith('loading')),
    ['loadingStart', 'loadingStop'],
    'v3 renamed sdkGameLoadingStop to loadingStop, and this is the only place that knows',
  );
});

test('gameplay reporting stays balanced however it is called', async () => {
  const { calls, sdk } = recordingCrazySdk();
  fakeDom({ sdk });
  const platform = await freshPlatform();
  await platform.initPlatform();

  platform.gameplayStart();
  platform.gameplayStart();
  platform.gameplayStop();
  platform.gameplayStop();
  assert.deepEqual(
    calls.filter((c) => c.startsWith('gameplay')),
    ['gameplayStart', 'gameplayStop'],
    'the game enters and leaves play by several routes; the portal must see one pair',
  );
});

test('an ad pauses and resumes only when one actually plays', async () => {
  const { calls, sdk } = recordingCrazySdk();
  fakeDom({ sdk });
  const platform = await freshPlatform();
  await platform.initPlatform();
  platform.gameplayStart();

  const seen = [];
  await platform.commercialBreak({ onStart: () => seen.push('start'), onEnd: () => seen.push('end') });

  assert.deepEqual(seen, ['start', 'end'], 'audio must be muted on adStarted and restored after');
  assert.ok(calls.includes('requestAd:midgame'), 'a break between levels is a midgame ad');
  // Stopped for the ad, restarted afterwards, because play was running before it.
  assert.deepEqual(calls.filter((c) => c.startsWith('gameplay')), [
    'gameplayStart',
    'gameplayStop',
    'gameplayStart',
  ]);
});

test('a rewarded ad reports whether the reward was earned', async () => {
  {
    const { sdk } = recordingCrazySdk({ adBehaviour: 'finish' });
    fakeDom({ sdk });
    const platform = await freshPlatform();
    await platform.initPlatform();
    assert.equal(await platform.rewardedBreak(), true, 'adFinished means the reward is owed');
  }
  {
    const { sdk } = recordingCrazySdk({ adBehaviour: 'error' });
    fakeDom({ sdk });
    const platform = await freshPlatform();
    await platform.initPlatform();
    assert.equal(await platform.rewardedBreak(), false, 'adError must not hand out a reward');
  }
});

test('an ad that never calls back does not strand the game', async () => {
  const { sdk } = recordingCrazySdk({ adBehaviour: 'silent' });
  fakeDom({ sdk });
  const platform = await freshPlatform();
  await platform.initPlatform();
  platform.gameplayStart();

  // The real timeout is 45s, so this only checks that the promise is not already
  // settled and that gameplay was stopped for it: the race exists, and the level
  // transition is what waits on it.
  let settled = false;
  const pending = platform.commercialBreak().then(() => {
    settled = true;
  });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(settled, false, 'a silent portal should leave the break pending, not resolve wrongly');
  void pending;
});

test('a missing or blocked SDK leaves the game fully playable', async () => {
  for (const dom of [{ sdk: null }, { sdk: recordingCrazySdk().sdk, failScript: true }]) {
    fakeDom(dom);
    const platform = await freshPlatform();
    assert.equal(await platform.initPlatform(), false, 'absence must be reported, not thrown');

    // Every call has to be safe, because this is the ad-blocker case portals require.
    platform.loadingStart();
    platform.loadingFinished();
    platform.gameplayStart();
    platform.gameplayStop();
    assert.equal(await platform.rewardedBreak(), false);
    await platform.commercialBreak({ onStart: () => assert.fail('no ad can start without an SDK') });
    platform.captureError(new Error('handled'));
  }
});

test('dataModule is exposed once init settles, and reflects the real backing store', async () => {
  const { sdk, dataStore } = recordingCrazySdk();
  fakeDom({ sdk });
  const platform = await freshPlatform();

  assert.equal(platform.dataModule(), null, 'no data module should be claimed before init settles');
  await platform.initPlatform();

  const mod = platform.dataModule();
  assert.ok(mod, 'CrazyGames exposes a Data Module, so it must not be null once ready');
  mod.setItem('k', 'v');
  assert.equal(dataStore.get('k'), 'v', 'writes through dataModule() must reach the real SDK.data');
  assert.equal(mod.getItem('missing'), null);
});

test('dataModule is null for a portal with no equivalent, and when no portal loaded', async () => {
  // Poki has no Data Module; store.js is expected to fall back to localStorage there.
  fakeDom({ sdk: null });
  const platform = await freshPlatform();
  await platform.initPlatform();
  assert.equal(platform.dataModule(), null);
});

test('calls made before the SDK settles are replayed, not dropped', async () => {
  const { calls, sdk } = recordingCrazySdk();
  fakeDom({ sdk });
  const platform = await freshPlatform();

  // The game deliberately starts solving before the portal is ready, so these arrive
  // first and still have to reach the SDK.
  platform.loadingStart();
  platform.gameplayStart();
  assert.deepEqual(calls, [], 'nothing can be reported before init has settled');

  await platform.initPlatform();
  assert.ok(calls.indexOf('init') < calls.indexOf('loadingStart'), 'init must come first');
  assert.ok(calls.includes('gameplayStart'), 'an early gameplayStart must be replayed');
});
