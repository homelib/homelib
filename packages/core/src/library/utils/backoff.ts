export class ExponentialBackoff implements PromiseLike<void> {
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

  then<TResult1 = void, TResult2 = never>(
    onfulfilled?: ((value: void) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.wait().then(onfulfilled, onrejected);
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

  private async wait(): Promise<void> {
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
}
