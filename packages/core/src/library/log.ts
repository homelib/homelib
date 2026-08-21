import type {Command} from './command.js';
import type {EndpointLogState} from './endpoint.js';

const endpointLogTargetMap = new WeakMap<object, EndpointLogTarget>();
const logListenerSet = new Set<LogListener>();

export type EndpointLogTarget = {
  readonly scopePath: readonly string[];
  readonly deviceName: string;
  readonly endpointName: string;
};

export type LogEvent =
  | EndpointCommandLogEvent
  | EndpointEventLogEvent
  | EndpointStateLogEvent
  | ErrorLogEvent;

export type EndpointCommandLogEvent = {
  readonly type: 'endpoint-command';
  /** Unix timestamp in milliseconds. */
  readonly timestamp: number;
  /** The execution decision made by Core. */
  readonly action: 'execute' | 'skip';
  readonly target: EndpointLogTarget;
  readonly connectionDescription: string | undefined;
  readonly commandDescription: string;
};

export type EndpointStateLogEvent = {
  readonly type: 'endpoint-state';
  /** Unix timestamp in milliseconds. */
  readonly timestamp: number;
  readonly target: EndpointLogTarget;
  readonly connectionDescription: string | undefined;
  readonly state: EndpointLogState;
  readonly previousState: EndpointLogState | undefined;
};

export type EndpointEventLogEvent = {
  readonly type: 'endpoint-event';
  /** Unix timestamp in milliseconds. */
  readonly timestamp: number;
  readonly target: EndpointLogTarget;
  readonly connectionDescription: string | undefined;
  readonly eventDescription: string;
};

export type ErrorLogEvent = {
  readonly type: 'error';
  /** Unix timestamp in milliseconds. */
  readonly timestamp: number;
  readonly error: unknown;
};

export type LogListener = (event: LogEvent) => void;

export function addLogListener(listener: LogListener): () => void {
  logListenerSet.add(listener);

  return () => {
    logListenerSet.delete(listener);
  };
}

export function setEndpointLogTarget(
  endpoint: object,
  target: EndpointLogTarget,
): void {
  endpointLogTargetMap.set(endpoint, target);
}

export function hasEndpointLogTarget(endpoint: object): boolean {
  return endpointLogTargetMap.has(endpoint);
}

export function logEndpointCommand(
  endpoint: object,
  connection: Loggable,
  command: Command,
  action: EndpointCommandLogEvent['action'],
  execution: Loggable | undefined = undefined,
): void {
  try {
    const target = endpointLogTargetMap.get(endpoint);

    if (target !== undefined) {
      emitLogEvent({
        type: 'endpoint-command',
        action,
        target,
        connectionDescription: safeLogString(
          connection,
          connection.constructor.name,
        ),
        commandDescription:
          safeLogString(execution) ??
          safeLogString(command) ??
          command.constructor.name,
      });
    }
  } catch {
    // Logging must never affect command processing.
  }
}

export function logEndpointState(
  endpoint: object,
  connection: Loggable,
  state: EndpointLogState,
  previousState: EndpointLogState | undefined,
): void {
  try {
    const target = endpointLogTargetMap.get(endpoint);

    if (target !== undefined) {
      emitLogEvent({
        type: 'endpoint-state',
        target,
        connectionDescription: safeLogString(
          connection,
          connection.constructor.name,
        ),
        state,
        previousState,
      });
    }
  } catch {
    // Logging must never affect state propagation.
  }
}

export function logEndpointEvent(
  endpoint: object,
  connection: Loggable,
  eventDescription: string,
): void {
  try {
    const target = endpointLogTargetMap.get(endpoint);

    if (target !== undefined) {
      emitLogEvent({
        type: 'endpoint-event',
        target,
        connectionDescription: safeLogString(
          connection,
          connection.constructor.name,
        ),
        eventDescription,
      });
    }
  } catch {
    // Logging must never affect event delivery.
  }
}

export function logEndpointError(error: unknown): void {
  emitLogEvent({type: 'error', error});
}

function emitLogEvent(event: LogEventWithoutTimestamp): void {
  const timestampedEvent = {...event, timestamp: Date.now()} as LogEvent;

  for (const listener of logListenerSet) {
    try {
      listener(timestampedEvent);
    } catch {
      // A log listener must never affect another listener or homelib itself.
    }
  }
}

function safeLogString(
  value: Loggable | undefined,
  errorFallback: string | undefined = undefined,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  try {
    const {toLogString} = value;

    return typeof toLogString === 'function'
      ? String(toLogString.call(value))
      : undefined;
  } catch {
    return errorFallback;
  }
}

export type Loggable = {
  readonly toLogString?: () => string;
};

type LogEventWithoutTimestamp =
  | Omit<EndpointCommandLogEvent, 'timestamp'>
  | Omit<EndpointEventLogEvent, 'timestamp'>
  | Omit<EndpointStateLogEvent, 'timestamp'>
  | Omit<ErrorLogEvent, 'timestamp'>;
