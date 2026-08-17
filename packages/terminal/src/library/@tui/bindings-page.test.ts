import {PassThrough} from 'node:stream';

import {EndpointPath, ProviderReference} from '@homelib/core';
import {Text, render} from 'ink';
import {createElement, useState} from 'react';

import {
  BindingDevicePage,
  BindingProviderPage,
  type BindingScopeItem,
  BindingsPage,
  type StaleBindingItem,
  StaleBindingsPage,
  getBindingSummary,
} from './bindings-page.js';

const TEST_PROVIDER = ProviderReference.satisfies({
  namespace: 'test',
  name: 'provider',
});

test('summarizes the complete scope subtree', () => {
  const scopes: readonly BindingScopeItem[] = [
    {
      path: ['home'],
      devices: [
        {
          name: 'door',
          endpoints: [
            {
              path: createEndpointPath(['home'], 'door', ''),
              name: '',
              provider: TEST_PROVIDER,
            },
          ],
        },
      ],
      scopes: [
        {
          path: ['home', 'living room'],
          devices: [
            {
              name: 'lights',
              endpoints: [
                {
                  path: createEndpointPath(
                    ['home', 'living room'],
                    'lights',
                    'main',
                  ),
                  name: 'main',
                  provider: undefined,
                },
                {
                  path: createEndpointPath(
                    ['home', 'living room'],
                    'lights',
                    'ambient',
                  ),
                  name: 'ambient',
                  provider: TEST_PROVIDER,
                },
              ],
            },
          ],
          scopes: [],
        },
      ],
    },
  ];

  expect(getBindingSummary(scopes)).toEqual({
    deviceCount: 2,
    configuredEndpointCount: 2,
    unconfiguredEndpointCount: 1,
  });
});

test('opens stale bindings from the bindings root', async () => {
  let selectStaleBindingsCallCount = 0;
  const terminal = renderTestTerminal(
    createElement(BindingsPage, {
      model: {
        scriptName: 'test',
        scopes: [],
        staleBindingCount: 2,
      },
      onBack: () => undefined,
      onSelect: () => undefined,
      onSelectStaleBindings: () => {
        selectStaleBindingsCallCount++;
      },
    }),
  );

  try {
    await terminal.flush();
    expect(terminal.frame()).toContain('2 stale bindings');
    expect(terminal.frame()).toContain('u stale');

    await terminal.input('u');
    expect(selectStaleBindingsCallCount).toBe(1);
  } finally {
    await terminal.close();
  }
});

test('removes duplicate stale paths with retry and locked input', async () => {
  const endpointPath = createEndpointPath(['home'], 'missing', 'main');
  let rejectFirstWrite: (error: Error) => void = () => undefined;
  const firstWrite = new Promise<void>((_resolve, reject) => {
    rejectFirstWrite = reject;
  });
  let removeAttemptCount = 0;
  let backCallCount = 0;
  const terminal = renderTestTerminal(
    createElement(StaleBindingsTestPage, {
      initialBindings: [
        {path: endpointPath, provider: TEST_PROVIDER},
        {path: endpointPath, provider: TEST_PROVIDER},
      ],
      onBack: () => {
        backCallCount++;
      },
      onRemove: async (_binding, removeAll) => {
        removeAttemptCount++;

        if (removeAttemptCount === 1) {
          return firstWrite;
        }

        removeAll();
      },
    }),
  );

  try {
    await terminal.flush();
    expect(terminal.frame()).toContain('2 stale bindings');
    expect(terminal.frame()).toContain('bindings › stale');
    expect(terminal.frame()).toContain('home › missing › main');
    expect(terminal.frame()).toContain('test · provider');

    await terminal.input('\r');
    expect(terminal.frame()).toContain(
      'remove all 2 stale bindings for home › missing › main?',
    );

    await terminal.input('y');
    expect(removeAttemptCount).toBe(1);
    expect(terminal.frame()).toContain('removing stale binding');

    await terminal.input('\u001B');
    await delay(25);
    await terminal.flush();
    expect(backCallCount).toBe(0);
    expect(terminal.frame()).toContain('removing stale binding');

    rejectFirstWrite(new Error('write failed.'));
    await waitForFrame(terminal, 'write failed.');
    expect(terminal.frame()).toContain('write failed.');

    await terminal.input('r');
    expect(removeAttemptCount).toBe(2);
    expect(terminal.frame()).toContain('stale binding removed.');
    expect(terminal.frame()).toContain('no stale bindings.');
  } finally {
    await terminal.close();
  }
});

test('unbinds from the core device page without a provider renderer', async () => {
  const endpointPath = createEndpointPath(['home'], 'light', 'main');
  let rejectFirstWrite: (error: Error) => void = () => undefined;
  const firstWrite = new Promise<void>((_resolve, reject) => {
    rejectFirstWrite = reject;
  });
  const unboundEndpoints: Array<{readonly path: EndpointPath}> = [];
  let unbindAttemptCount = 0;
  let backCallCount = 0;
  const onUnbind = async (endpoint: {
    readonly path: EndpointPath;
  }): Promise<void> => {
    unboundEndpoints.push(endpoint);
    unbindAttemptCount++;

    if (unbindAttemptCount === 1) {
      return firstWrite;
    }
  };
  const terminal = renderTestTerminal(
    createElement(BindingDevicePage, {
      model: {
        scriptName: 'test',
        scopePath: ['home'],
        device: {
          name: 'light',
          endpoints: [
            {
              path: endpointPath,
              name: 'main',
              provider: TEST_PROVIDER,
            },
          ],
        },
        providers: [],
      },
      onBack: () => {
        backCallCount++;
      },
      onSelectProvider: () => undefined,
      onUnbind,
    }),
  );

  try {
    await terminal.flush();
    expect(terminal.frame()).toContain('bindings › home › light');
    await terminal.input('u');
    expect(terminal.frame()).toContain('bound endpoints');
    expect(terminal.frame()).toContain('test · provider');

    await terminal.input('\r');
    expect(terminal.frame()).toContain('remove the binding for main?');

    await terminal.input('y');
    expect(unboundEndpoints).toEqual([
      expect.objectContaining({path: endpointPath}),
    ]);
    expect(terminal.frame()).toContain('removing binding');

    await terminal.input('\u001B');
    await delay(25);
    await terminal.flush();
    expect(backCallCount).toBe(0);
    expect(terminal.frame()).toContain('removing binding');

    rejectFirstWrite(new Error('write failed.'));
    await waitForFrame(terminal, 'write failed.');
    expect(terminal.frame()).toContain('write failed.');

    await terminal.input('r');
    expect(unbindAttemptCount).toBe(2);
    expect(terminal.frame()).toContain('binding removed.');
    expect(terminal.frame()).toContain('no providers declared.');
  } finally {
    await terminal.close();
  }
});

test('shows the provider as a match rather than part of the breadcrumb', async () => {
  const terminal = renderTestTerminal(
    createElement(BindingProviderPage, {
      model: {
        scriptName: 'test',
        scopePath: ['home', 'room'],
        deviceName: 'light',
        provider: {namespace: 'miot', name: 'xiaomi'},
      },
      children: createElement(Text, undefined, 'provider content'),
    }),
  );

  try {
    await terminal.flush();
    expect(terminal.frame()).toContain('bindings › home › room › light');
    expect(terminal.frame()).toContain('match with miot · xiaomi');
    expect(terminal.frame()).not.toContain('light › miot');
  } finally {
    await terminal.close();
  }
});

function createEndpointPath(
  scopePath: string[],
  deviceName: string,
  endpointName: string,
): EndpointPath {
  return EndpointPath.satisfies({scopePath, deviceName, endpointName});
}

type StaleBindingsTestPageProps = {
  readonly initialBindings: readonly StaleBindingItem[];
  readonly onBack: () => void;
  readonly onRemove: (
    binding: StaleBindingItem,
    removeAll: () => void,
  ) => Promise<void>;
};

function StaleBindingsTestPage({
  initialBindings,
  onBack,
  onRemove,
}: StaleBindingsTestPageProps): React.JSX.Element {
  const [bindings, setBindings] = useState(initialBindings);

  return createElement(StaleBindingsPage, {
    model: {scriptName: 'test', bindings},
    onBack,
    onRemove: binding =>
      onRemove(binding, () => {
        const pathKey = getEndpointPathKey(binding.path);

        setBindings(currentBindings =>
          currentBindings.filter(
            item => getEndpointPathKey(item.path) !== pathKey,
          ),
        );
      }),
  });
}

function getEndpointPathKey(path: EndpointPath): string {
  return JSON.stringify([path.scopePath, path.deviceName, path.endpointName]);
}

async function waitForFrame(
  terminal: TestTerminal,
  expected: string,
): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt++) {
    await terminal.flush();

    if (terminal.frame().includes(expected)) {
      return;
    }
  }

  throw new Error(`Timed out waiting for terminal frame: ${expected}`);
}

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
