import {DeviceEventEmitter} from './event.js';
import {type ErrorLogEvent, addLogListener} from './log.js';

test('emits every occurrence and supports idempotent disposal', () => {
  const event = new DeviceEventEmitter<number>();
  const occurrences: number[] = [];
  const dispose = event.subscribe(value => occurrences.push(value));

  event.emit(1);
  event.emit(1);
  dispose();
  dispose();
  event.emit(2);

  expect(occurrences).toEqual([1, 1]);
});

test('isolates listener failures', () => {
  const event = new DeviceEventEmitter<string>();
  const error = new Error('listener failed');
  const errors: ErrorLogEvent[] = [];
  const occurrences: string[] = [];
  const removeLogListener = addLogListener(logEvent => {
    if (logEvent.type === 'error') {
      errors.push(logEvent);
    }
  });

  try {
    event.subscribe(() => {
      throw error;
    });
    event.subscribe(value => occurrences.push(value));
    event.emit('event');

    expect(occurrences).toEqual(['event']);
    expect(errors.map(logEvent => logEvent.error)).toEqual([error]);
  } finally {
    removeLogListener();
  }
});
