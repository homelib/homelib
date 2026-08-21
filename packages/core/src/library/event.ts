import {logEndpointError} from './log.js';

/** Subscribes to future occurrences and returns an idempotent disposer. */
export type DeviceEvent<T = void> = (
  listener: DeviceEventListener<T>,
) => () => void;

export type DeviceEventListener<T = void> = (
  ...args: DeviceEventArguments<T>
) => void;

type DeviceEventArguments<T> = [T] extends [void] ? [] : [event: T];

/** A device event source that providers can publish to. */
export class DeviceEventEmitter<T = void> {
  private readonly listenerSet = new Set<DeviceEventListener<T>>();

  readonly subscribe: DeviceEvent<T> = listener => {
    this.listenerSet.add(listener);

    return () => {
      this.listenerSet.delete(listener);
    };
  };

  /** Emits one occurrence synchronously to every current listener. */
  emit(...args: DeviceEventArguments<T>): void {
    for (const listener of [...this.listenerSet]) {
      try {
        listener(...args);
      } catch (error) {
        logEndpointError(error);
      }
    }
  }
}
