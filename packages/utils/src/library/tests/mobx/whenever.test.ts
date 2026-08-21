import {type IReactionDisposer, action, observable} from 'mobx';

import {type Whenever, whenever} from '../../mobx/whenever.js';

test('calls back whenever the condition becomes true', () => {
  const condition = observable.box(false);
  const callback = import.meta.jest.fn();
  const dispose = whenever(() => condition.get(), callback);

  expect(callback).not.toHaveBeenCalled();

  action(() => condition.set(true))();
  expect(callback).toHaveBeenCalledTimes(1);

  action(() => condition.set(false))();
  action(() => condition.set(true))();
  expect(callback).toHaveBeenCalledTimes(2);

  dispose();
  action(() => condition.set(false))();
  action(() => condition.set(true))();
  expect(callback).toHaveBeenCalledTimes(2);
});

test('calls back immediately when the condition is initially true', () => {
  const callback = import.meta.jest.fn();
  const dispose = whenever(() => true, callback);

  expect(callback).toHaveBeenCalledTimes(1);
  dispose();
});

test('does not call back again while the condition remains true', () => {
  const dependency = observable.box(0);
  const callback = import.meta.jest.fn();
  const dispose = whenever(() => {
    dependency.get();
    return true;
  }, callback);

  expect(callback).toHaveBeenCalledTimes(1);

  action(() => dependency.set(1))();
  expect(callback).toHaveBeenCalledTimes(1);
  dispose();
});

test('builds immutable conjunctions and reacts when all conditions become true', () => {
  const first = observable.box(false);
  const second = observable.box(false);
  const firstCallback = import.meta.jest.fn();
  const bothCallback = import.meta.jest.fn();
  const firstCondition: Whenever = whenever(() => first.get());
  const bothConditions = firstCondition.and(() => second.get());
  const disposeFirst: IReactionDisposer = firstCondition.then(firstCallback);
  const disposeBoth = bothConditions.then(bothCallback);

  action(() => first.set(true))();
  expect(firstCallback).toHaveBeenCalledTimes(1);
  expect(bothCallback).not.toHaveBeenCalled();

  action(() => second.set(true))();
  expect(firstCallback).toHaveBeenCalledTimes(1);
  expect(bothCallback).toHaveBeenCalledTimes(1);

  action(() => second.set(false))();
  action(() => second.set(true))();
  expect(firstCallback).toHaveBeenCalledTimes(1);
  expect(bothCallback).toHaveBeenCalledTimes(2);

  disposeFirst();
  disposeBoth();
});

test('does not evaluate a condition until then starts the reaction', () => {
  const condition = import.meta.jest.fn(() => true);
  const callback = import.meta.jest.fn();
  const pending = whenever(condition);

  expect(condition).not.toHaveBeenCalled();

  const dispose = pending.then(callback);
  expect(condition).toHaveBeenCalledTimes(1);
  expect(callback).toHaveBeenCalledTimes(1);
  dispose();
});

test('disposes each then activation when its conditions stop matching', () => {
  const active = observable.box(false);
  const activations: number[] = [];
  const disposals: number[] = [];
  let nextActivation = 0;
  const dispose = whenever(() => active.get()).then(() => {
    const activation = ++nextActivation;
    activations.push(activation);

    return () => {
      disposals.push(activation);
    };
  });

  action(() => active.set(true))();
  action(() => active.set(false))();
  action(() => active.set(true))();

  expect(activations).toEqual([1, 2]);
  expect(disposals).toEqual([1]);

  dispose();
  expect(disposals).toEqual([1, 2]);
});

test('supports activation disposal through the callback overload', () => {
  const active = observable.box(true);
  const deactivate = import.meta.jest.fn();
  const dispose = whenever(
    () => active.get(),
    () => deactivate,
  );

  expect(deactivate).not.toHaveBeenCalled();
  action(() => active.set(false))();
  expect(deactivate).toHaveBeenCalledTimes(1);
  dispose();
  expect(deactivate).toHaveBeenCalledTimes(1);
});

test('autoruns and tracks its callback only while conditions are true', () => {
  const active = observable.box(false);
  const dependency = observable.box(0);
  const values: number[] = [];
  const dispose = whenever(() => active.get()).autorun(() => {
    values.push(dependency.get());
  });

  action(() => dependency.set(1))();
  expect(values).toEqual([]);

  action(() => active.set(true))();
  action(() => dependency.set(2))();
  expect(values).toEqual([1, 2]);

  action(() => active.set(false))();
  action(() => dependency.set(3))();
  expect(values).toEqual([1, 2]);

  action(() => active.set(true))();
  expect(values).toEqual([1, 2, 3]);

  dispose();
});

test('reacts immediately whenever conditions become true', () => {
  const active = observable.box(false);
  const value = observable.box(0);
  const values: Array<readonly [number, number | undefined]> = [];
  const dispose = whenever(() => active.get()).react(
    () => value.get(),
    (nextValue, previousValue) => {
      values.push([nextValue, previousValue]);
    },
  );

  action(() => value.set(1))();
  expect(values).toEqual([]);

  action(() => active.set(true))();
  action(() => value.set(2))();
  expect(values).toEqual([
    [1, undefined],
    [2, 1],
  ]);

  action(() => active.set(false))();
  action(() => value.set(3))();
  expect(values).toHaveLength(2);

  action(() => active.set(true))();
  expect(values).toEqual([
    [1, undefined],
    [2, 1],
    [3, undefined],
  ]);

  dispose();
});

test('rejects accidental promise assimilation', async () => {
  const condition = import.meta.jest.fn(() => true);

  await expect(Promise.resolve(whenever(condition))).rejects.toThrow(
    'Whenever cannot be used as a promise.',
  );
  expect(condition).not.toHaveBeenCalled();
});
