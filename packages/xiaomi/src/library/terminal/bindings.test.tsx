import {PassThrough} from 'node:stream';
import {setTimeout as delay} from 'node:timers/promises';
import {stripVTControlCharacters} from 'node:util';

import {
  EndpointPath,
  Light,
  LightEndpoint,
  type ProviderBindingDevice,
  type ProviderBindingRequest,
} from '@homelib/core';
import {render} from 'ink';
import {createElement} from 'react';

import type {MiotProviderFilteredDiscovery} from '../configuration.js';
import '../index.js';
import type {MiotSpecInstance} from '../miot/index.js';
import {MiotProvider} from '../provider.js';

import {MiotProviderBindings} from './bindings.js';

test('confirms the default device match as one batch and returns after saving', async () => {
  const spec = createLightSpec('default-device-match', ['Main Light']);
  const restoreFetch = installSpecFetch(spec);
  const provider = createFakeProvider('default-device-match', spec);
  const bindingOperation = createDeferred<void>();
  const bindingBatches: Array<readonly ProviderBindingRequest[]> = [];
  let backCallCount = 0;
  let completeCallCount = 0;
  const terminal = renderTestTerminal(
    createElement(MiotProviderBindings, {
      provider,
      device: createLogicalDevice(),
      providerBindings: [],
      onBind: requests => {
        bindingBatches.push(requests);
        return bindingOperation.promise;
      },
      onBack: () => {
        backCallCount++;
      },
      onComplete: () => {
        completeCallCount++;
      },
    }),
  );

  try {
    await terminal.flushUntil(frame => frame.includes('choose a device'));
    expect(terminal.frame()).toContain('Ceiling Light');
    expect(terminal.frame()).toContain('My Home ›');
    expect(terminal.frame()).toContain('Living Room');

    await terminal.input('\r');
    await terminal.flushUntil(
      frame =>
        frame.includes('device match') && frame.includes('› bind device'),
    );
    const summary = terminal.frame();
    const summaryLines = summary.split('\n').map(line => line.trim());
    const endpointIndex = summaryLines.indexOf('● main [ready]');

    expect(summary).toContain('device match');
    expect(summary).toContain('main');
    expect(summary).toContain('[ready]');
    expect(summary).toContain('Main Light');
    expect(summary).toContain('› bind device');
    expect(summaryLines[endpointIndex + 1]).toBe('Main Light');
    expect(summary).not.toContain('matched automatically');
    expect(summary).not.toContain('1 endpoint');
    expectInternalDetailsToBeHidden(summary);
    expect(bindingBatches).toHaveLength(0);

    await terminal.input('\r');
    expect(bindingBatches).toHaveLength(1);
    expect(bindingBatches[0]).toHaveLength(1);
    expect(bindingBatches[0]?.[0]).toMatchObject({
      endpoint: {
        scopePath: ['My Home', 'Living Room'],
        deviceName: 'Ceiling Light',
        endpointName: '',
      },
      replaceExisting: false,
      metadata: {
        version: 1,
        device: {did: 'physical-light', urn: spec.type},
      },
    });
    expect(terminal.frame()).toContain('saving device match…');
    expect(backCallCount).toBe(0);
    expect(completeCallCount).toBe(0);

    bindingOperation.resolve();
    await terminal.flushUntil(() => completeCallCount === 1);
    expect(bindingBatches).toHaveLength(1);
    expect(backCallCount).toBe(0);
    expect(completeCallCount).toBe(1);
  } finally {
    bindingOperation.resolve();
    await terminal.close();
    restoreFetch();
  }
}, 10_000);

test('does not offer ambiguous service combinations for manual matching', async () => {
  const spec = createLightSpec('optional-endpoint-match', [
    'Main Light',
    'Ambient Light',
  ]);
  const restoreFetch = installSpecFetch(spec);
  const provider = createFakeProvider('optional-endpoint-match', spec);
  const terminal = renderTestTerminal(
    createElement(MiotProviderBindings, {
      provider,
      device: createLogicalDevice(),
      providerBindings: [],
      onBind: () => Promise.resolve(),
      onBack: () => undefined,
      onComplete: () => undefined,
    }),
  );

  try {
    await terminal.flushUntil(frame => frame.includes('choose a device'));
    expect(terminal.frame()).toContain('no matching devices found.');
    expect(terminal.frame()).not.toContain('endpoint matching');
    expect(terminal.frame()).not.toContain('possible matches');
    expectInternalDetailsToBeHidden(terminal.frame());
  } finally {
    await terminal.close();
    restoreFetch();
  }
}, 10_000);

test('groups devices by location and emphasizes binding status', async () => {
  const spec = createLightSpec('device-list-labels', ['Main Light']);
  const restoreFetch = installSpecFetch(spec);
  const provider = createFakeProvider('device-list-labels', spec, {
    devices: [
      {
        did: 'bound-light',
        name: 'Ceiling Light',
        model: 'test.light',
        specType: spec.type,
        homeName: 'My Home',
        roomName: 'Living Room',
      },
      {
        did: 'offline-light',
        name: 'Offline Light',
        model: 'test.light',
        specType: spec.type,
        homeName: 'My Home',
        roomName: 'Bedroom',
        online: false,
      },
      {
        did: 'used-light',
        name: 'Used Light',
        model: 'test.light',
        specType: spec.type,
        homeName: 'My Home',
        roomName: 'Living Room',
      },
      ...Array.from({length: 4}, (_, index) => ({
        did: `bedroom-light-${index + 1}`,
        name: `Bedroom Light ${index + 1}`,
        model: 'test.light',
        specType: spec.type,
        homeName: 'My Home',
        roomName: 'Bedroom',
      })),
    ],
  });
  const createBindingPlan = import.meta.jest.spyOn(
    provider,
    'createEndpointConnectionBindingPlan',
  );
  const device = createLogicalDevice();
  const endpoint = device.endpoints[0];

  if (endpoint === undefined || spec.services[0] === undefined) {
    throw new Error('Missing test endpoint or service.');
  }

  const terminal = renderTestTerminal(
    createElement(MiotProviderBindings, {
      provider,
      device,
      providerBindings: [
        {
          endpoint: endpoint.path,
          endpointReference: endpoint.endpoint,
          deviceConstructors: device.deviceConstructors,
          metadata: createTestMetadata('bound-light', spec),
        },
        {
          endpoint: EndpointPath.satisfies({
            scopePath: ['Other Home'],
            deviceName: 'Other Light',
            endpointName: '',
          }),
          endpointReference: new LightEndpoint(),
          deviceConstructors: [Light],
          metadata: createTestMetadata('used-light', spec),
        },
      ],
      onBind: () => Promise.resolve(),
      onBack: () => undefined,
      onComplete: () => undefined,
    }),
  );

  try {
    await terminal.flushUntil(
      frame =>
        frame.includes('› Ceiling Light [bound here]') &&
        frame.includes('Used Light [used elsewhere]') &&
        frame.includes('1–6 of 7'),
    );
    const frame = terminal.frame();
    const lines = frame.split('\n').map(line => line.trim());
    const livingRoomIndex = lines.indexOf('My Home › Living Room');
    const bedroomIndex = lines.indexOf('My Home › Bedroom');
    const rangeIndex = lines.indexOf('1–6 of 7');

    expect(frame.match(/My Home › Living Room/g)).toHaveLength(1);
    expect(lines.slice(livingRoomIndex, livingRoomIndex + 3)).toEqual([
      'My Home › Living Room',
      '› Ceiling Light [bound here]',
      'Used Light [used elsewhere]',
    ]);
    expect(lines.slice(bedroomIndex, bedroomIndex + 2)).toEqual([
      'My Home › Bedroom',
      'Offline Light [offline]',
    ]);
    expect(frame).not.toContain('endpoint ready');
    expect(lines[rangeIndex - 1]).toBe('');
    expect(createBindingPlan).toHaveBeenCalledTimes(2);
    expect(createBindingPlan).toHaveBeenNthCalledWith(
      1,
      endpoint.endpoint,
      device.deviceConstructors,
      createTestMetadata('bound-light', spec),
    );
  } finally {
    await terminal.close();
    restoreFetch();
  }
}, 10_000);

test('reports success only after an explicit device reload', async () => {
  const spec = createLightSpec('reload', ['Main Light']);
  const restoreFetch = installSpecFetch(spec);
  const provider = createFakeProvider('reload', spec);
  const terminal = renderTestTerminal(
    createElement(MiotProviderBindings, {
      provider,
      device: createLogicalDevice(),
      providerBindings: [],
      onBind: () => Promise.resolve(),
      onBack: () => undefined,
      onComplete: () => undefined,
    }),
  );

  try {
    await terminal.flushUntil(frame => frame.includes('choose a device'));
    expect(terminal.frame()).not.toContain('devices reloaded.');

    await terminal.input('r');
    await terminal.flushUntil(frame => frame.includes('devices reloaded.'));

    await terminal.input('\u001B[B');
    expect(terminal.frame()).not.toContain('devices reloaded.');
  } finally {
    await terminal.close();
    restoreFetch();
  }
}, 10_000);

test('returns to the logical device on escape without completing', async () => {
  const spec = createLightSpec('escape', ['Main Light']);
  const restoreFetch = installSpecFetch(spec);
  const provider = createFakeProvider('escape', spec);
  let backCallCount = 0;
  let completeCallCount = 0;
  const terminal = renderTestTerminal(
    createElement(MiotProviderBindings, {
      provider,
      device: createLogicalDevice(),
      providerBindings: [],
      onBind: () => Promise.resolve(),
      onBack: () => {
        backCallCount++;
      },
      onComplete: () => {
        completeCallCount++;
      },
    }),
  );

  try {
    await terminal.flushUntil(frame => frame.includes('choose a device'));
    await terminal.input('\u001B');
    await delay(25);
    await terminal.flushUntil(() => backCallCount === 1);

    expect(backCallCount).toBe(1);
    expect(completeCallCount).toBe(0);
  } finally {
    await terminal.close();
    restoreFetch();
  }
}, 10_000);

function createFakeProvider(
  name: string,
  spec: MiotSpecInstance,
  options: {
    readonly devices?: MiotProviderFilteredDiscovery['devices'];
  } = {},
): MiotProvider {
  const provider = new MiotProvider(name);
  const discovery: MiotProviderFilteredDiscovery = {
    account: {cloudServer: 'cn', userId: 'test-user'},
    homes: [],
    devices: options.devices ?? [
      {
        did: 'physical-light',
        name: 'Ceiling Light',
        model: 'test.light',
        specType: spec.type,
        homeName: 'My Home',
        roomName: 'Living Room',
      },
    ],
  };

  Object.defineProperty(provider.configuration, 'discoverDevices', {
    configurable: true,
    value: () => Promise.resolve(discovery),
  });
  Object.defineProperty(provider, 'getSpecInstance', {
    configurable: true,
    value: () => Promise.resolve(spec),
  });

  return provider;
}

function createTestMetadata(did: string, spec: MiotSpecInstance): unknown {
  return {
    version: 1,
    device: {did, model: 'test.light', urn: spec.type},
  };
}

function createLogicalDevice(): ProviderBindingDevice {
  const path = EndpointPath.satisfies({
    scopePath: ['My Home', 'Living Room'],
    deviceName: 'Ceiling Light',
    endpointName: '',
  });

  return {
    name: path.deviceName,
    deviceConstructors: [Light],
    endpoints: [
      {
        path,
        endpoint: new LightEndpoint(),
        binding: undefined,
      },
    ],
  };
}

function createLightSpec(
  name: string,
  serviceNames: readonly string[],
): MiotSpecInstance {
  return {
    type: `urn:miot-spec-v2:device:light:0000A001:${name}:1`,
    description: 'Test Light',
    services: serviceNames.map((serviceName, index) => ({
      iid: index + 2,
      type: `urn:miot-spec-v2:service:light:00007802:${name}:${index + 1}`,
      description: serviceName,
      properties: [
        {
          iid: 1,
          type: `urn:miot-spec-v2:property:on:00000006:${name}:1`,
          description: 'Switch Status',
          format: 'bool',
          access: ['read', 'write', 'notify'],
        },
      ],
    })),
  };
}

function installSpecFetch(spec: MiotSpecInstance): () => void {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => new Response(JSON.stringify(spec));

  return () => {
    globalThis.fetch = originalFetch;
  };
}

function expectInternalDetailsToBeHidden(frame: string): void {
  const normalizedFrame = frame.toLowerCase();

  expect(normalizedFrame).not.toContain('service');
  expect(normalizedFrame).not.toContain('siid');
  expect(normalizedFrame).not.toContain('piid');
  expect(normalizedFrame).not.toContain('urn:');
}

function createDeferred<T>(): Deferred<T> {
  let resolve: (value: T | PromiseLike<T>) => void = () => undefined;
  let reject: (reason?: unknown) => void = () => undefined;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return {promise, resolve, reject};
}

type Deferred<T> = {
  readonly promise: Promise<T>;
  readonly resolve: (value: T | PromiseLike<T>) => void;
  readonly reject: (reason?: unknown) => void;
};

function renderTestTerminal(node: React.ReactNode): TestTerminal {
  const stdin = new PassThrough() as PassThrough & NodeJS.ReadStream;
  const stdout = new PassThrough() as PassThrough & NodeJS.WriteStream;
  const stderr = new PassThrough() as PassThrough & NodeJS.WriteStream;
  let frame = '';

  Object.defineProperties(stdin, {
    isTTY: {value: true},
    setRawMode: {value: () => stdin},
    ref: {value: () => stdin},
    unref: {value: () => stdin},
  });
  Object.defineProperties(stdout, {
    isTTY: {value: true},
    columns: {value: 120},
    rows: {value: 40},
  });
  Object.defineProperties(stderr, {
    isTTY: {value: true},
    columns: {value: 120},
    rows: {value: 40},
  });

  stdout.on('data', chunk => {
    frame = stripVTControlCharacters(String(chunk));
  });

  const instance = render(node, {
    stdin,
    stdout,
    stderr,
    debug: true,
    exitOnCtrlC: false,
    patchConsole: false,
    interactive: true,
    maxFps: 1_000,
  });
  const flush = async (): Promise<void> => {
    await new Promise<void>(resolve => {
      setImmediate(resolve);
    });
    await instance.waitUntilRenderFlush();
  };

  return {
    frame: () => frame,
    flushUntil: async predicate => {
      for (let attempt = 0; attempt < 20; attempt++) {
        await flush();

        if (predicate(frame)) {
          return;
        }
      }

      throw new Error(`Expected terminal state was not reached:\n${frame}`);
    },
    input: async value => {
      stdin.write(value);
      await flush();
    },
    close: async () => {
      instance.unmount();
      await instance.waitUntilExit();
      instance.cleanup();
      stdin.end();
      stdout.end();
      stderr.end();
    },
  };
}

type TestTerminal = {
  readonly frame: () => string;
  readonly flushUntil: (predicate: (frame: string) => boolean) => Promise<void>;
  readonly input: (value: string) => Promise<void>;
  readonly close: () => Promise<void>;
};
