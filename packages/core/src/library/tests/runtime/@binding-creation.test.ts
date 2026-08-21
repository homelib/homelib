import type {EndpointConnectionBinding} from '../../endpoint.js';
import type {
  EndpointConnectionBindingPlan,
  PreparedEndpointConnectionBindingPlan,
} from '../../provider.js';
import {
  createEndpointConnectionBindings,
  prepareEndpointConnectionBindingPlans,
} from '../../runtime/@binding-creation.js';

test('waits for every preparation and preserves plan order', async () => {
  const firstPlan = createPlan(() => createTestBinding());
  const secondPlan = createPlan(() => createTestBinding());
  const firstPreparation =
    createDeferred<PreparedEndpointConnectionBindingPlan>();
  const preparation = prepareEndpointConnectionBindingPlans([
    createUnpreparedPlan(() => firstPreparation.promise),
    createUnpreparedPlan(() => Promise.resolve(secondPlan)),
  ]);
  let settled = false;

  void preparation.finally(() => {
    settled = true;
  });
  await Promise.resolve();
  expect(settled).toBe(false);

  firstPreparation.resolve(firstPlan);

  await expect(preparation).resolves.toEqual([firstPlan, secondPlan]);
});

test('waits for every preparation before reporting failures', async () => {
  const preparationError = new Error('preparation failed');
  const remainingPreparation =
    createDeferred<PreparedEndpointConnectionBindingPlan>();
  const preparation = prepareEndpointConnectionBindingPlans([
    createUnpreparedPlan(() => Promise.reject(preparationError)),
    createUnpreparedPlan(() => remainingPreparation.promise),
  ]);
  let settled = false;

  void preparation.catch(() => {
    settled = true;
  });
  await Promise.resolve();
  expect(settled).toBe(false);

  remainingPreparation.resolve(createPlan(() => createTestBinding()));

  await expect(preparation).rejects.toBe(preparationError);
});

test('reports multiple preparation failures together', async () => {
  const firstError = new Error('first preparation failed');
  const secondError = new Error('second preparation failed');

  await expect(
    prepareEndpointConnectionBindingPlans([
      createUnpreparedPlan(() => Promise.reject(firstError)),
      createUnpreparedPlan(() => Promise.reject(secondError)),
    ]),
  ).rejects.toMatchObject({errors: [firstError, secondError]});
});

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
): PreparedEndpointConnectionBindingPlan {
  return {
    resourceKeys: [],
    persistedMetadata: {},
    create: async () => create(),
  };
}

function createUnpreparedPlan(
  prepare: () => PromiseLike<PreparedEndpointConnectionBindingPlan>,
): EndpointConnectionBindingPlan {
  return {prepare};
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
