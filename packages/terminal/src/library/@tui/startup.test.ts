import {PassThrough} from 'node:stream';

import {
  BindingFile,
  type BootstrapBindingDevice,
  type BootstrapBindingScope,
  Device,
  EndpointPath,
  type EndpointReference,
  ProviderReference,
} from '@homelib/core';
import {render} from 'ink';
import {createElement} from 'react';

import {
  Startup,
  type StartupTuiModel,
  createProviderBindingDevice,
  createProviderBindingRecords,
} from './startup.js';

class TestDevice extends Device {}

const ENDPOINT_PATH = EndpointPath.satisfies({
  scopePath: ['home'],
  deviceName: 'light',
  endpointName: '',
});
const ENDPOINT: EndpointReference = {name: '', ready: false};
const DEVICE_CONSTRUCTORS = [TestDevice] as const;
const DEVICE: BootstrapBindingDevice = {
  name: 'light',
  deviceConstructors: DEVICE_CONSTRUCTORS,
  endpoints: [{path: ENDPOINT_PATH, endpoint: ENDPOINT}],
};

test('preserves logical device constructor identity for provider binding', () => {
  const bindingFile = BindingFile.satisfies({
    version: 0,
    bindings: [
      {
        endpoint: ENDPOINT_PATH,
        provider: {namespace: 'test', name: 'provider'},
        metadata: {resource: 'light'},
      },
    ],
  });

  const providerBindingDevice = createProviderBindingDevice(
    DEVICE,
    bindingFile,
  );

  expect(providerBindingDevice.deviceConstructors).toBe(DEVICE_CONSTRUCTORS);
  expect(providerBindingDevice.endpoints).toEqual([
    {
      path: ENDPOINT_PATH,
      endpoint: ENDPOINT,
      binding: bindingFile.bindings[0],
    },
  ]);
});

test('joins active provider bindings with the current topology', () => {
  const activeBinding = {
    endpoint: ENDPOINT_PATH,
    provider: {namespace: 'test', name: 'provider'},
    metadata: {resource: 'active'},
  } as const;
  const staleBinding = {
    endpoint: EndpointPath.satisfies({
      scopePath: ['home'],
      deviceName: 'removed light',
      endpointName: '',
    }),
    provider: {namespace: 'test', name: 'provider'},
    metadata: {resource: 'stale'},
  } as const;
  const otherProviderBinding = {
    endpoint: ENDPOINT_PATH,
    provider: {namespace: 'other', name: 'provider'},
    metadata: {resource: 'other'},
  } as const;
  const bindingFile = BindingFile.satisfies({
    version: 0,
    bindings: [activeBinding, staleBinding, otherProviderBinding],
  });
  const scopes: readonly BootstrapBindingScope[] = [
    {path: ['home'], scopes: [], devices: [DEVICE]},
  ];

  expect(
    createProviderBindingRecords(
      scopes,
      bindingFile,
      ProviderReference.satisfies({namespace: 'test', name: 'provider'}),
    ),
  ).toEqual([
    {
      endpoint: ENDPOINT_PATH,
      endpointReference: ENDPOINT,
      deviceConstructors: DEVICE_CONSTRUCTORS,
      metadata: activeBinding.metadata,
    },
  ]);
});

test('keeps parent navigation and returns directly to the startup menu with q', async () => {
  const bindingFile = BindingFile.satisfies({version: 0, bindings: []});
  const bindingScopes: readonly BootstrapBindingScope[] = [
    {path: ['home'], scopes: [], devices: [DEVICE]},
  ];
  const model: StartupTuiModel = {
    scriptName: 'test',
    providers: [],
    bindingScopes,
    bindingFile,
    updateBindingFile: createNextBindingFile =>
      Promise.resolve(createNextBindingFile(bindingFile)),
  };
  const terminal = renderTestTerminal(createElement(Startup, {model}));

  try {
    await terminal.flush();
    const startupFrame = terminal.frame();
    expect(startupFrame).toContain('run');

    await terminal.input('\u001B[B');
    await terminal.input('\u001B[B');
    await terminal.input('\r');
    expect(terminal.frame()).toContain('0 stale bindings');

    await terminal.input('\r');
    expect(terminal.frame()).toContain('bindings › home');

    await terminal.input('\u001B');
    await delay(25);
    await terminal.flush();
    expect(terminal.frame()).toContain('0 stale bindings');
    expect(terminal.frame()).not.toContain('bindings › home');

    await terminal.input('\r');
    expect(terminal.frame()).toContain('bindings › home');

    await terminal.input('q');
    expect(terminal.frame()).toBe(startupFrame);

    await terminal.input('q');
    expect(terminal.frame()).toBe(startupFrame);

    await terminal.input('\u001B[B');
    await terminal.input('\r');
    expect(terminal.frame()).toContain('no providers declared.');

    await terminal.input('q');
    expect(terminal.frame()).toBe(startupFrame);
  } finally {
    await terminal.close();
  }
});

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
    frame = String(chunk);
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
    flush,
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
  readonly flush: () => Promise<void>;
  readonly input: (value: string) => Promise<void>;
  readonly close: () => Promise<void>;
};

function delay(milliseconds: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, milliseconds);
  });
}
