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
  EndpointCommandLogEvent | EndpointStateLogEvent | ErrorLogEvent;

export type EndpointCommandLogEvent = {
  readonly type: 'endpoint-command';
  readonly target: EndpointLogTarget;
  readonly connectionDescription: string | undefined;
  readonly commandDescription: string;
};

export type EndpointStateLogEvent = {
  readonly type: 'endpoint-state';
  readonly target: EndpointLogTarget;
  readonly connectionDescription: string | undefined;
  readonly state: EndpointLogState;
  readonly previousState: EndpointLogState | undefined;
};

export type ErrorLogEvent = {
  readonly type: 'error';
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
): void {
  try {
    const target = endpointLogTargetMap.get(endpoint);

    if (target !== undefined) {
      emitLogEvent({
        type: 'endpoint-command',
        target,
        connectionDescription: safeLogString(connection),
        commandDescription: safeLogString(command) ?? command.constructor.name,
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
        connectionDescription: safeLogString(connection),
        state,
        previousState,
      });
    }
  } catch {
    // Logging must never affect state propagation.
  }
}

export function logEndpointError(error: unknown): void {
  emitLogEvent({type: 'error', error});
}

function emitLogEvent(event: LogEvent): void {
  for (const listener of logListenerSet) {
    try {
      listener(event);
    } catch {
      // A log listener must never affect another listener or homelib itself.
    }
  }
}

function safeLogString(value: Loggable): string | undefined {
  if (!('toLogString' in value) || typeof value.toLogString !== 'function') {
    return undefined;
  }

  try {
    return String(value.toLogString());
  } catch {
    return value.constructor.name;
  }
}

export type Loggable = {
  readonly toLogString?: () => string;
};
