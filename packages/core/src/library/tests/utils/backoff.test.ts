import {ExponentialBackoff} from '../../utils/backoff.js';

test('waits with exponentially increasing delays up to the maximum', async () => {
  import.meta.jest.useFakeTimers();

  try {
    const backoff = new ExponentialBackoff(5, 10);

    await expectDelay(5);
    await expectDelay(10);
    await expectDelay(10);

    async function expectDelay(delay: number): Promise<void> {
      let completed = false;
      const waiting = backoff.then(() => {
        completed = true;
      });

      await import.meta.jest.advanceTimersByTimeAsync(delay - 1);
      expect(completed).toBe(false);

      await import.meta.jest.advanceTimersByTimeAsync(1);
      await waiting;
      expect(completed).toBe(true);
    }
  } finally {
    import.meta.jest.useRealTimers();
  }
});

test('reset interrupts the current wait', async () => {
  const backoff = new ExponentialBackoff(1_000, 2_000);
  const waiting = Promise.resolve(backoff);
  await Promise.resolve();
  backoff.reset();
  await waiting;
});
