export class ExponentialBackoff {
  private delay: number;

  private waiting:
    | {
        readonly timeout: unknown;
        readonly resolve: () => void;
      }
    | undefined;

  constructor(
    readonly initialDelay: number,
    readonly maximumDelay: number,
  ) {
    if (
      !Number.isFinite(initialDelay) ||
      initialDelay <= 0 ||
      !Number.isFinite(maximumDelay) ||
      maximumDelay < initialDelay
    ) {
      throw new RangeError('Invalid exponential backoff delays.');
    }

    this.delay = initialDelay;
  }

  async wait(): Promise<void> {
    if (this.waiting !== undefined) {
      throw new Error('Exponential backoff is already waiting.');
    }

    const delay = this.delay;
    this.delay = Math.min(delay * 2, this.maximumDelay);

    await new Promise<void>(resolve => {
      const timeout = setTimeout(() => {
        this.waiting = undefined;
        resolve();
      }, delay);

      this.waiting = {timeout, resolve};
    });
  }

  reset(): void {
    this.delay = this.initialDelay;

    const waiting = this.waiting;

    if (waiting === undefined) {
      return;
    }

    this.waiting = undefined;
    clearTimeout(waiting.timeout);
    waiting.resolve();
  }
}
