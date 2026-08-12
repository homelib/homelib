import type {EndpointConnectionBinding} from '../endpoint.js';
import type {EndpointConnectionBindingPlan} from '../provider.js';

import {createEndpointConnectionBindings} from './@binding-creation.js';

test('waits for every creation and disposes successful bindings on failure', async () => {
  const firstBinding = createTestBinding();
  const firstCreation = createDeferred<EndpointConnectionBinding>();
  const creation = createEndpointConnectionBindings([
    createPlan(() => firstCreation.promise),
    createPlan(() => Promise.reject(new Error('creation failed'))),
  ]);

  await Promise.resolve();
  expect(firstBinding.dispose).not.toHaveBeenCalled();

  firstCreation.resolve(firstBinding);

  await expect(creation).rejects.toThrow('creation failed');
  expect(firstBinding.dispose).toHaveBeenCalledTimes(1);
  expect(firstBinding.bind).not.toHaveBeenCalled();
});

test('reports creation and rollback failures together', async () => {
  const disposalError = new Error('rollback failed');
  const binding = createTestBinding(async () => {
    throw disposalError;
  });

  await expect(
    createEndpointConnectionBindings([
      createPlan(() => binding),
      createPlan(() => Promise.reject(new Error('creation failed'))),
    ]),
  ).rejects.toMatchObject({
    errors: [
      expect.objectContaining({message: 'creation failed'}),
      disposalError,
    ],
  });
});

test('continues rollback when a binding dispose throws synchronously', async () => {
  const creationError = new Error('creation failed');
  const disposalError = new Error('synchronous rollback failed');
  const synchronousFailureBinding = {
    bind: import.meta.jest.fn(),
    dispose: import.meta.jest.fn((): PromiseLike<void> => {
      throw disposalError;
    }),
  };
  const remainingBinding = createTestBinding();

  await expect(
    createEndpointConnectionBindings([
      createPlan(() => synchronousFailureBinding),
      createPlan(() => remainingBinding),
      createPlan(() => Promise.reject(creationError)),
    ]),
  ).rejects.toMatchObject({errors: [creationError, disposalError]});

  expect(synchronousFailureBinding.dispose).toHaveBeenCalledTimes(1);
  expect(remainingBinding.dispose).toHaveBeenCalledTimes(1);
  expect(remainingBinding.bind).not.toHaveBeenCalled();
});

test('returns successful bindings in plan order without binding them', async () => {
  const first = createTestBinding();
  const second = createTestBinding();

  await expect(
    createEndpointConnectionBindings([
      createPlan(() => Promise.resolve(first)),
      createPlan(() => second),
    ]),
  ).resolves.toEqual([first, second]);
  expect(first.bind).not.toHaveBeenCalled();
  expect(second.bind).not.toHaveBeenCalled();
});

function createPlan(
  create: () =>
    PromiseLike<EndpointConnectionBinding> | EndpointConnectionBinding,
): EndpointConnectionBindingPlan {
  return {resourceKeys: [], create: async () => create()};
}

function createTestBinding(
  dispose: () => void | PromiseLike<void> = () => undefined,
): {
  readonly bind: jest.Mock;
  readonly dispose: jest.Mock;
} {
  return {
    bind: import.meta.jest.fn(),
    dispose: import.meta.jest.fn(async () => dispose()),
  };
}

function createDeferred<T>(): {
  readonly promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolvePromise!: (value: T) => void;
  const promise = new Promise<T>(resolve => {
    resolvePromise = resolve;
  });

  return {promise, resolve: resolvePromise};
}
