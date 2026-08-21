import {
  DeviceEvent,
  DeviceEventEmitter,
  type DeviceEventSource,
} from './event.js';
import {type ErrorLogEvent, addLogListener} from './log.js';

test('emits every occurrence and supports idempotent disposal', () => {
  const event = new DeviceEventEmitter<TestValueEvent>();
  const occurrences: number[] = [];
  const dispose = event.subscribe(occurrence =>
    occurrences.push(occurrence.value),
  );

  event.emit(new TestValueEvent(1));
  event.emit(new TestValueEvent(1));
  dispose();
  dispose();
  event.emit(new TestValueEvent(2));

  expect(occurrences).toEqual([1, 1]);
});

test('isolates listener failures', () => {
  const event = new DeviceEventEmitter<TestValueEvent>();
  const error = new Error('listener failed');
  const errors: ErrorLogEvent[] = [];
  const occurrences: number[] = [];
  const removeLogListener = addLogListener(logEvent => {
    if (logEvent.type === 'error') {
      errors.push(logEvent);
    }
  });

  try {
    event.subscribe(() => {
      throw error;
    });
    event.subscribe(occurrence => occurrences.push(occurrence.value));
    event.emit(new TestValueEvent(1));

    expect(occurrences).toEqual([1]);
    expect(errors.map(logEvent => logEvent.error)).toEqual([error]);
  } finally {
    removeLogListener();
  }
});

test('isolates rejected async listeners', async () => {
  const event = new DeviceEventEmitter<TestValueEvent>();
  const error = new Error('Async listener failed.');
  const errors: ErrorLogEvent[] = [];
  const removeLogListener = addLogListener(logEvent => {
    if (logEvent.type === 'error') {
      errors.push(logEvent);
    }
  });

  try {
    event.subscribe(async () => {
      throw error;
    });
    event.emit(new TestValueEvent(1));
    await Promise.resolve();
    await Promise.resolve();

    expect(errors.map(logEvent => logEvent.error)).toEqual([error]);
  } finally {
    removeLogListener();
  }
});

test('uses the concrete class name as the default log string', () => {
  expect(new DefaultLogEvent().toLogString()).toBe('DefaultLogEvent');
});

test('keeps marker events, sources, and emitters type-safe', () => {
  const firstEvent = new FirstMarkerEvent();
  const secondEvent = new SecondMarkerEvent();
  const firstEmitter = new DeviceEventEmitter<FirstMarkerEvent>();
  const secondEmitter = new DeviceEventEmitter<SecondMarkerEvent>();
  const firstSource = firstEmitter.subscribe;
  const secondSource = secondEmitter.subscribe;
  const compatible: DeviceEventSource<FirstMarkerEvent> = firstSource;

  // @ts-expect-error Different marker occurrences must remain distinct.
  const incompatibleEvent: FirstMarkerEvent = secondEvent;

  // @ts-expect-error Different marker occurrences must not share a source type.
  const incompatible: DeviceEventSource<FirstMarkerEvent> = secondSource;

  // @ts-expect-error Emitters consume events and therefore must not be widened.
  const widenedEmitter: DeviceEventEmitter<DeviceEvent<string>> = firstEmitter;

  expect(firstEvent).not.toBe(secondEvent);
  expect(incompatibleEvent).toBe(secondEvent);
  expect(compatible).toBe(firstSource);
  expect(incompatible).toBe(secondSource);
  expect(widenedEmitter).toBe(firstEmitter);
});

class TestValueEvent extends DeviceEvent<'testValue'> {
  constructor(readonly value: number) {
    super();
  }
}

class DefaultLogEvent extends DeviceEvent<'defaultLog'> {}

class FirstMarkerEvent extends DeviceEvent<'firstMarker'> {}

class SecondMarkerEvent extends DeviceEvent<'secondMarker'> {}
