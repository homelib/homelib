import type {
  EndpointLogState,
  EndpointLogTarget,
  LogEvent,
} from '@homelib/core';

import {formatLogText} from './@log-format.js';

export function writeLogEvent(event: LogEvent): void {
  if (event.type === 'error') {
    console.error(
      `${getLogPrefix(event.timestamp)} ${formatLogText(['bold', 'red'], 'error')}`,
      event.error,
    );
    return;
  }

  const prefix = getEndpointLogPrefix(
    event.timestamp,
    event.target,
    event.connectionDescription,
  );

  if (event.type === 'endpoint-command') {
    if (event.action === 'skip') {
      console.info(
        `${prefix} ${formatLogText(['dim'], 'skip')} ${formatLogText('dim', event.commandDescription)}`,
      );
      return;
    }

    console.info(
      `${prefix} ${formatLogText(['bold', 'yellow'], 'execute')} ${formatLogText('yellow', event.commandDescription)}`,
    );
    return;
  }

  if (event.type === 'endpoint-event') {
    console.info(
      `${prefix} ${formatLogText(['bold', 'magenta'], 'event')} ${formatLogText('magenta', event.eventDescription)}`,
    );
    return;
  }

  const changes = getLogStateChanges(event.state, event.previousState);

  if (changes.length > 0) {
    console.info(
      `${prefix} ${formatLogText(['bold', 'cyan'], 'state')} ${changes.join(' ')}`,
    );
  }
}

function getEndpointLogPrefix(
  timestamp: number,
  target: EndpointLogTarget,
  connectionDescription: string | undefined,
): string {
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
  const physicalTarget =
    connectionDescription === undefined
      ? ''
      : `${separator}${formatLogText('dim', connectionDescription)}`;

  return `${getLogPrefix(timestamp)} ${logicalTarget}${physicalTarget}`;
}

function getLogPrefix(timestamp: number): string {
  return `${formatLogText('dim', '[homelib]')} ${formatLogText('dim', formatLogTimestamp(timestamp))}`;
}

function formatLogTimestamp(timestamp: number): string {
  const date = new Date(timestamp);

  return `${date.getFullYear()}-${padLogTimestampPart(date.getMonth() + 1)}-${padLogTimestampPart(date.getDate())} ${padLogTimestampPart(date.getHours())}:${padLogTimestampPart(date.getMinutes())}:${padLogTimestampPart(date.getSeconds())}.${padLogTimestampPart(date.getMilliseconds(), 3)}`;
}

function padLogTimestampPart(value: number, length = 2): string {
  return String(value).padStart(length, '0');
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

type EndpointLogStateValue = string | number | boolean;
