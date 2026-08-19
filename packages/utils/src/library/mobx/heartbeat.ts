import {action, observable} from 'mobx';

/**
 * Creates a heartbeat for MobX reactions. Call the returned function inside an
 * `autorun`/`reaction` to ensure it re-runs at least once every `interval`
 * milliseconds. Each call resets the timer.
 */
export function createHeartbeat(interval: number): () => void {
  const heartbeat = createDynamicHeartbeat();

  return () => heartbeat(interval);
}

/**
 * Creates a heartbeat whose interval is selected at each call. Call the
 * returned function inside an `autorun`/`reaction`; each call resets the timer.
 */
export function createDynamicHeartbeat(): (interval: number) => void {
  const revision = observable.box(0);
  const updateRevision = action(() => {
    revision.set(revision.get() + 1);
  });
  let timeout: NodeJS.Timeout | undefined;

  return interval => {
    revision.get();
    clearTimeout(timeout);
    timeout = setTimeout(updateRevision, interval);
  };
}
