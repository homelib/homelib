import {OAuthSessionManager} from './session-manager.js';
import type {OAuthSession} from './session.js';

test('refreshes before expiry and applies the new token', async () => {
  const scheduler = new TestScheduler();
  const sessions = [
    createSession('initial', 120_000),
    createSession('refreshed', 240_000),
  ];
  const appliedTokens: string[] = [];
  let loadCount = 0;
  const manager = createManager(scheduler, appliedTokens, async () => {
    const session = sessions[loadCount++];

    if (session === undefined) {
      throw new Error('Unexpected session load.');
    }

    return session;
  });

  await manager.getSession();

  expect(appliedTokens).toEqual(['initial']);
  expect(scheduler.nextDelay).toBe(60_000);

  await scheduler.advanceBy(60_000);

  expect(loadCount).toBe(2);
  expect(appliedTokens).toEqual(['initial', 'refreshed']);
  expect(scheduler.nextDelay).toBe(120_000);
});

test('shares a refresh and retries failures with a short backoff', async () => {
  const scheduler = new TestScheduler();
  const appliedTokens: string[] = [];
  const refresh = createDeferred<OAuthSession>();
  let loadCount = 0;
  let failureCount = 0;
  const manager = createManager(
    scheduler,
    appliedTokens,
    async () => {
      loadCount++;

      if (loadCount === 1) {
        return createSession('initial', 120_000);
      } else if (loadCount === 2) {
        throw new Error('refresh failed');
      }

      return refresh.promise;
    },
    () => {
      failureCount++;
    },
  );

  await manager.getSession();
  await scheduler.advanceBy(60_000);

  expect(failureCount).toBe(1);
  expect(scheduler.nextDelay).toBe(1_000);

  await scheduler.advanceBy(1_000);
  const joinedRefresh = manager.getSession();

  expect(loadCount).toBe(3);

  refresh.resolve(createSession('refreshed', 240_000));
  await joinedRefresh;

  expect(appliedTokens).toEqual(['initial', 'refreshed']);
});

test('reset cancels timers and ignores a refresh already in flight', async () => {
  const scheduler = new TestScheduler();
  const appliedTokens: string[] = [];
  const refresh = createDeferred<OAuthSession>();
  let loadCount = 0;
  const manager = createManager(scheduler, appliedTokens, () => {
    loadCount++;

    return loadCount === 1
      ? Promise.resolve(createSession('initial', 120_000))
      : refresh.promise;
  });

  await manager.getSession();
  await scheduler.advanceBy(60_000);

  const reset = manager.reset();
  refresh.resolve(createSession('stale', 240_000));
  await reset;

  expect(appliedTokens).toEqual(['initial']);
  expect(scheduler.timerCount).toBe(0);
});

test('does not return or join a session load invalidated by reset', async () => {
  const scheduler = new TestScheduler();
  const appliedTokens: string[] = [];
  const staleLoad = createDeferred<OAuthSession>();
  const currentLoad = createDeferred<OAuthSession>();
  const loads = [staleLoad, currentLoad];
  let loadCount = 0;
  const manager = createManager(scheduler, appliedTokens, () => {
    const load = loads[loadCount++];

    if (load === undefined) {
      throw new Error('Unexpected session load.');
    }

    return load.promise;
  });

  const staleSession = manager.getSession();
  const reset = manager.reset();
  const currentSession = manager.getSession();

  expect(loadCount).toBe(2);

  staleLoad.resolve(createSession('stale', 120_000));
  await reset;
  await expect(staleSession).rejects.toThrow(
    'OAuth session load was invalidated.',
  );

  currentLoad.resolve(createSession('current', 120_000));
  await expect(currentSession).resolves.toMatchObject({
    token: {accessToken: 'current'},
  });
  expect(appliedTokens).toEqual(['current']);
});

test('every concurrent reset waits for a detached session load', async () => {
  const scheduler = new TestScheduler();
  const appliedTokens: string[] = [];
  const load = createDeferred<OAuthSession>();
  const manager = createManager(scheduler, appliedTokens, () => load.promise);
  const staleSession = manager.getSession();
  let firstResetComplete = false;
  let secondResetComplete = false;
  const firstReset = manager.reset().then(() => {
    firstResetComplete = true;
  });
  const secondReset = manager.reset().then(() => {
    secondResetComplete = true;
  });

  await flushMicrotasks();
  expect(firstResetComplete).toBe(false);
  expect(secondResetComplete).toBe(false);

  load.resolve(createSession('stale', 120_000));
  await Promise.all([firstReset, secondReset]);

  await expect(staleSession).rejects.toThrow(
    'OAuth session load was invalidated.',
  );
  expect(appliedTokens).toEqual([]);
});

function createManager(
  scheduler: TestScheduler,
  appliedTokens: string[],
  loadSession: () => Promise<OAuthSession>,
  reportRefreshFailure = (): void => undefined,
): OAuthSessionManager {
  return new OAuthSessionManager({
    sessionPath: 'unused',
    applyAccessToken: accessToken => {
      appliedTokens.push(accessToken);
    },
    dependencies: {
      loadSession,
      now: () => scheduler.now,
      setTimer: scheduler.setTimer,
      clearTimer: scheduler.clearTimer,
      reportRefreshFailure,
    },
  });
}

function createSession(accessToken: string, expiresAt: number): OAuthSession {
  return {
    uuid: '0123456789abcdef0123456789abcdef',
    cloudServer: 'cn',
    redirectUrl: 'http://homeassistant.local/callback',
    expiresAt: new Date(expiresAt).toISOString(),
    token: {
      accessToken,
      refreshToken: `${accessToken}-refresh`,
      expiresIn: 120,
    },
  };
}

function createDeferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>(resolveValue => {
    resolve = resolveValue;
  });

  return {promise, resolve};
}

class TestScheduler {
  now = 0;

  private nextId = 0;

  private readonly timerMap = new Map<
    number,
    {readonly time: number; readonly callback: () => void}
  >();

  get timerCount(): number {
    return this.timerMap.size;
  }

  get nextDelay(): number | undefined {
    const nextTime = Math.min(
      ...[...this.timerMap.values()].map(timer => timer.time),
    );

    return Number.isFinite(nextTime) ? nextTime - this.now : undefined;
  }

  readonly setTimer = (callback: () => void, delay: number): number => {
    const id = this.nextId++;

    this.timerMap.set(id, {time: this.now + delay, callback});
    return id;
  };

  readonly clearTimer = (timer: unknown): void => {
    this.timerMap.delete(timer as number);
  };

  async advanceBy(delay: number): Promise<void> {
    const target = this.now + delay;

    while (true) {
      const next = [...this.timerMap].sort(
        ([, left], [, right]) => left.time - right.time,
      )[0];

      if (next === undefined || next[1].time > target) {
        break;
      }

      this.now = next[1].time;
      this.timerMap.delete(next[0]);
      next[1].callback();
      await flushMicrotasks();
    }

    this.now = target;
    await flushMicrotasks();
  }
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 8; index++) {
    await Promise.resolve();
  }
}
