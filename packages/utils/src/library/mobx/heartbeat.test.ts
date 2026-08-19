import {action, autorun, observable} from 'mobx';

import {createDynamicHeartbeat, createHeartbeat} from './heartbeat.js';

test('re-runs the autorun after the interval', () => {
  import.meta.jest.useFakeTimers();

  try {
    let count = 0;
    const heartbeat = createHeartbeat(1000);

    const dispose = autorun(() => {
      heartbeat();
      count++;
    });

    expect(count).toBe(1);

    import.meta.jest.advanceTimersByTime(999);
    expect(count).toBe(1);

    import.meta.jest.advanceTimersByTime(1);
    expect(count).toBe(2);

    dispose();
  } finally {
    import.meta.jest.useRealTimers();
  }
});

test('resets the interval when the autorun re-runs', () => {
  import.meta.jest.useFakeTimers();

  try {
    let count = 0;
    const heartbeat = createHeartbeat(1000);
    const value = observable.box(0);

    const dispose = autorun(() => {
      heartbeat();
      value.get();
      count++;
    });

    expect(count).toBe(1);

    import.meta.jest.advanceTimersByTime(600);
    action(() => value.set(1))();
    expect(count).toBe(2);

    import.meta.jest.advanceTimersByTime(600);
    expect(count).toBe(2);

    import.meta.jest.advanceTimersByTime(400);
    expect(count).toBe(3);

    dispose();
  } finally {
    import.meta.jest.useRealTimers();
  }
});

test('selects a new interval whenever the autorun re-runs', () => {
  import.meta.jest.useFakeTimers();

  try {
    let count = 0;
    const heartbeat = createDynamicHeartbeat();
    const interval = observable.box(1000);

    const dispose = autorun(() => {
      heartbeat(interval.get());
      count++;
    });

    expect(count).toBe(1);

    import.meta.jest.advanceTimersByTime(600);
    action(() => interval.set(2000))();
    expect(count).toBe(2);

    import.meta.jest.advanceTimersByTime(1999);
    expect(count).toBe(2);

    import.meta.jest.advanceTimersByTime(1);
    expect(count).toBe(3);

    dispose();
  } finally {
    import.meta.jest.useRealTimers();
  }
});
