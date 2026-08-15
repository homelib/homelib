import {action, autorun, observable} from 'mobx';

import {createKeepAlive} from './keep-alive.js';

test('re-runs the autorun after the interval', () => {
  import.meta.jest.useFakeTimers();

  try {
    let count = 0;
    const keepAlive = createKeepAlive(1000);

    const dispose = autorun(() => {
      keepAlive();
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
    const keepAlive = createKeepAlive(1000);
    const value = observable.box(0);

    const dispose = autorun(() => {
      keepAlive();
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
