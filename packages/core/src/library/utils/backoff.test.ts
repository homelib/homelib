import {ExponentialBackoff} from './backoff.js';

test('waits with exponentially increasing delays up to the maximum', async () => {
  const backoff = new ExponentialBackoff(5, 10);
  const elapsedTimes: number[] = [];
  const startedAt = Date.now();

  await schedule();
  await schedule();
  await schedule();

  expect(elapsedTimes[0]).toBeGreaterThanOrEqual(5);
  expect(elapsedTimes[1] - elapsedTimes[0]).toBeGreaterThanOrEqual(10);
  expect(elapsedTimes[2] - elapsedTimes[1]).toBeGreaterThanOrEqual(10);

  async function schedule(): Promise<void> {
    await backoff;
    elapsedTimes.push(Date.now() - startedAt);
  }
});

test('reset interrupts the current wait', async () => {
  const backoff = new ExponentialBackoff(1_000, 2_000);
  const waiting = Promise.resolve(backoff);
  await Promise.resolve();
  backoff.reset();
  await waiting;
});
