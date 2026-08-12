import {formatLogText} from './@log-format.js';
import type {Command} from './command.js';
import type {EndpointLogState} from './endpoint.js';

const endpointLogTargetMap = new WeakMap<object, EndpointLogTarget>();

export type EndpointLogTarget = {
  readonly scopePath: readonly string[];
  readonly deviceName: string;
  readonly endpointName: string;
};

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
    const prefix = getEndpointLogPrefix(endpoint, connection);

    if (prefix !== undefined) {
      const description = safeLogString(command) ?? command.constructor.name;

      console.info(
        `${prefix} ${formatLogText(['bold', 'yellow'], 'command')} ${formatLogText('yellow', description)}`,
      );
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
    const prefix = getEndpointLogPrefix(endpoint, connection);

    if (prefix === undefined) {
      return;
    }

    const changes = getLogStateChanges(state, previousState);

    if (changes.length > 0) {
      console.info(
        `${prefix} ${formatLogText(['bold', 'cyan'], 'state')} ${changes.join(' ')}`,
      );
    }
  } catch {
    // Logging must never affect state propagation.
  }
}

export function logEndpointError(error: unknown): void {
  try {
    console.error(error);
  } catch {
    // Logging must never affect command processing.
  }
}

function getEndpointLogPrefix(
  endpoint: object,
  connection: Loggable,
): string | undefined {
  const target = endpointLogTargetMap.get(endpoint);

  if (target === undefined) {
    return undefined;
  }

  const separator = formatLogText('dim', ' · ');
  const scope = target.scopePath.join(formatLogText('dim', ' › '));
  const logicalTarget = [
    scope,
    `${formatLogText('cyan', 'device')} ${target.deviceName}`,
    target.endpointName === ''
      ? undefined
      : `${formatLogText('cyan', 'endpoint')} ${target.endpointName}`,
  ]
    .filter(value => value !== undefined && value !== '')
    .join(separator);
  const connectionDescription = safeLogString(connection);
  const physicalTarget =
    connectionDescription === undefined
      ? ''
      : `${separator}${formatLogText('dim', connectionDescription)}`;

  return `${formatLogText('dim', '[homelib]')} ${logicalTarget}${physicalTarget}`;
}

function getLogStateChanges(
  state: EndpointLogState,
  previousState: EndpointLogState | undefined,
): string[] {
  if (state.ready === false) {
    return previousState?.ready === false
      ? []
      : [formatLogStateChange('ready', false)];
  }

  const changes: string[] = [];
  const reportAll = previousState?.ready !== true;

  for (const [name, value] of Object.entries(state)) {
    if (
      value !== undefined &&
      (reportAll || !Object.is(value, previousState?.[name]))
    ) {
      changes.push(formatLogStateChange(name, value));
    }
  }

  return changes;
}

function formatLogStateChange(
  name: string,
  value: EndpointLogStateValue,
): string {
  const formattedValue = formatLogStateValue(value);
  const styledValue =
    name === 'ready'
      ? formatLogText(value === true ? 'green' : 'yellow', formattedValue)
      : formattedValue;

  return `${formatLogText('cyan', name)}${formatLogText('dim', '=')}${styledValue}`;
}

function formatLogStateValue(value: EndpointLogStateValue): string {
  return typeof value === 'string' ? JSON.stringify(value) : String(value);
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

type EndpointLogStateValue = string | number | boolean;
