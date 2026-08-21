import {logEndpointError} from './log.js';

/** One semantic device event occurrence. */
export abstract class DeviceEvent<out TType extends string> {
  declare protected readonly deviceEventBrand: TType;

  toLogString(): string {
    return this.constructor.name;
  }
}

export type DeviceEventListener<in TEvent extends DeviceEvent<string>> = (
  event: TEvent,
) => void;

/** Subscribes to future occurrences and returns an idempotent disposer. */
export type DeviceEventSource<out TEvent extends DeviceEvent<string>> = (
  listener: DeviceEventListener<TEvent>,
) => () => void;

/** A device event source that providers can publish to. */
export class DeviceEventEmitter<in out TEvent extends DeviceEvent<string>> {
  private readonly listenerSet = new Set<DeviceEventListener<TEvent>>();

  subscribe(
    this: DeviceEventEmitter<TEvent>,
    listener: DeviceEventListener<TEvent>,
  ): () => void {
    this.listenerSet.add(listener);

    return () => {
      this.listenerSet.delete(listener);
    };
  }

  /** Creates a subscriber that can be passed around without its emitter. */
  createSubscriber(
    this: DeviceEventEmitter<TEvent>,
  ): DeviceEventSource<TEvent> {
    return this.subscribe.bind(this);
  }

  /** Emits one occurrence synchronously to every current listener. */
  emit(event: TEvent): void {
    for (const listener of [...this.listenerSet]) {
      try {
        const result: unknown = listener(event);

        if (isPromiseLike(result)) {
          void Promise.resolve(result).catch(logEndpointError);
        }
      } catch (error) {
        logEndpointError(error);
      }
    }
  }
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  if (
    (typeof value !== 'object' || value === null) &&
    typeof value !== 'function'
  ) {
    return false;
  }

  return typeof (value as {readonly then?: unknown}).then === 'function';
}
