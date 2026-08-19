import {action, observable} from 'mobx';

import {whenever} from './whenever.js';

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
