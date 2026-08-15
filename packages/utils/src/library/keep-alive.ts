import {action, observable} from 'mobx';

import {debounce} from './debounce.js';

/**
 * Creates a keep-alive tracker for MobX reactions. Call the returned function
 * inside an `autorun`/`reaction` to ensure it re-runs at least once every
 * `interval` milliseconds. Each call resets the timer.
 */
export function createKeepAlive(interval: number): () => void {
  const keepAlive = observable.box(0);

  const scheduleKeepAlive = debounce(
    action(() => {
      keepAlive.set(keepAlive.get() + 1);
    }),
    interval,
  );

  return () => {
    keepAlive.get();
    scheduleKeepAlive();
  };
}
