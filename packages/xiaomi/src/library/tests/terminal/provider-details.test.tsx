import {PassThrough} from 'node:stream';

import {Box, Text, render, useInput} from 'ink';
import {useState} from 'react';

import type {
  MiotProviderAccount,
  MiotProviderConfigurationSnapshot,
  MiotProviderHomeReference,
} from '../../configuration.js';
import {MiotProvider} from '../../provider.js';
import {MiotProviderDetails} from '../../terminal/provider-details.js';

const AUTHORIZATION_URL = 'https://example.test/authorize';
const FIRST_CALLBACK_URL =
  'http://homeassistant.local:8123/api/webhook/test?code=secret-q-code&state=q-state';
const SECOND_CALLBACK_URL =
  'http://homeassistant.local:8123/api/webhook/test?code=second-secret-code&state=q-state';
const READY_SNAPSHOT = {
  account: {cloudServer: 'cn', userId: 'user-1'},
  selectionSource: 'saved',
  homes: [
    {
      source: 'owned',
      id: 'home-1',
      name: 'My Home',
      included: true,
    },
  ],
} as const satisfies MiotProviderConfigurationSnapshot;

test('submits pasted callback URLs without triggering root navigation', async () => {
  const authorizationCompletion = createDeferred<void>();
  const acceptedSubmission = createDeferred<void>();
  const submittedCallbackUrls: string[] = [];
  let cancelCount = 0;
  let backCount = 0;
  let menuCount = 0;
  const cancel = (): Promise<void> => {
    cancelCount++;
    return Promise.resolve();
  };
  const submitCallbackUrl = (callbackUrl: string): Promise<void> => {
    submittedCallbackUrls.push(callbackUrl);
    return callbackUrl === FIRST_CALLBACK_URL
      ? Promise.reject(new Error('invalid callback URL.'))
      : acceptedSubmission.promise;
  };
  const provider = createAuthorizationProvider({
    cancel,
    submitCallbackUrl,
    wait: () => authorizationCompletion.promise,
  });
  const terminal = renderTestTerminal(
    <AuthorizationTestRoot
      provider={provider}
      onBack={() => {
        backCount++;
      }}
      onMenu={() => {
        menuCount++;
      }}
    />,
  );

  try {
    await openAuthorization(terminal);

    expect(terminal.frame()).toContain(
      'if the browser cannot connect, paste the complete callback URL here.',
    );

    await terminal.paste(`\n${FIRST_CALLBACK_URL}\n`);
    await terminal.flushUntil(frame =>
      frame.includes('callback rejected: invalid callback URL.'),
    );

    expect(submittedCallbackUrls).toEqual([FIRST_CALLBACK_URL]);
    expect(menuCount).toBe(0);
    expect(backCount).toBe(0);
    expect(terminal.frame()).toContain('paste callback URL · esc cancel');
    expect(terminal.frame()).not.toContain('secret-q-code');

    await terminal.paste(SECOND_CALLBACK_URL);
    await terminal.flushUntil(frame =>
      frame.includes('processing pasted callback…'),
    );

    expect(submittedCallbackUrls).toEqual([
      FIRST_CALLBACK_URL,
      SECOND_CALLBACK_URL,
    ]);
    expect(menuCount).toBe(0);
    expect(terminal.frame()).not.toContain('second-secret-code');

    acceptedSubmission.resolve();
    await terminal.flushUntil(frame =>
      frame.includes('callback received; completing authorization…'),
    );

    expect(terminal.frame()).not.toContain('paste callback URL');
    expect(terminal.frame()).not.toContain('second-secret-code');

    await terminal.input('q');
    await terminal.flushUntil(frame => frame.includes('main menu'));

    expect(menuCount).toBe(1);
    expect(backCount).toBe(0);
    expect(cancelCount).toBe(1);
  } finally {
    await terminal.close();
  }
});

test('keeps escape as authorization cancellation instead of back navigation', async () => {
  const authorizationCompletion = createDeferred<void>();
  let cancelCount = 0;
  let submitCount = 0;
  let backCount = 0;
  let menuCount = 0;
  const provider = createAuthorizationProvider({
    cancel: () => {
      cancelCount++;
      return Promise.resolve();
    },
    submitCallbackUrl: () => {
      submitCount++;
      return Promise.resolve();
    },
    wait: () => authorizationCompletion.promise,
  });
  const terminal = renderTestTerminal(
    <AuthorizationTestRoot
      provider={provider}
      onBack={() => {
        backCount++;
      }}
      onMenu={() => {
        menuCount++;
      }}
    />,
  );

  try {
    await openAuthorization(terminal);
    await terminal.input('\u001B');
    await delay(25);
    await terminal.flush();

    expect(terminal.frame()).toContain('cancelling authorization…');
    expect(cancelCount).toBe(1);
    expect(submitCount).toBe(0);
    expect(backCount).toBe(0);
    expect(menuCount).toBe(0);
  } finally {
    await terminal.close();
  }
});

test('reports save and reload success and uses o for logout', async () => {
  const saveCalls: Array<
    readonly [MiotProviderAccount, readonly MiotProviderHomeReference[]]
  > = [];
  let loadCount = 0;
  const load = (): Promise<MiotProviderConfigurationSnapshot> => {
    loadCount++;
    return Promise.resolve(READY_SNAPSHOT);
  };
  const saveIncludedHomes = (
    account: MiotProviderAccount,
    homes: readonly MiotProviderHomeReference[],
  ): Promise<void> => {
    saveCalls.push([account, homes]);
    return Promise.resolve();
  };
  const provider = createReadyProvider({load, saveIncludedHomes});
  const terminal = renderTestTerminal(
    <AuthorizationTestRoot
      provider={provider}
      onBack={() => undefined}
      onMenu={() => undefined}
    />,
  );

  try {
    await terminal.flushUntil(frame => frame.includes('o log out'));

    expect(terminal.frame()).not.toContain('l log out');

    await terminal.input(' ');
    await terminal.flushUntil(frame => frame.includes('enter save'));
    await terminal.input('\r');
    await terminal.flushUntil(frame => frame.includes('home selection saved.'));

    expect(saveCalls).toEqual([[READY_SNAPSHOT.account, []]]);

    await terminal.input('\u001B[B');
    expect(terminal.frame()).not.toContain('home selection saved.');

    await terminal.input('r');
    await terminal.flushUntil(frame =>
      frame.includes('configuration reloaded.'),
    );

    expect(loadCount).toBe(2);

    await terminal.input('l');
    expect(terminal.frame()).not.toContain('configuration reloaded.');
    expect(terminal.frame()).not.toContain('log out of this miot provider?');

    await terminal.input('o');
    await terminal.flushUntil(frame =>
      frame.includes('log out of this miot provider?'),
    );
  } finally {
    await terminal.close();
  }
});

type AuthorizationTestRootProps = {
  readonly provider: MiotProvider;
  readonly onBack: () => void;
  readonly onMenu: () => void;
};

function AuthorizationTestRoot({
  provider,
  onBack,
  onMenu,
}: AuthorizationTestRootProps): React.JSX.Element {
  const [atMenu, setAtMenu] = useState(false);

  useInput(input => {
    if (input === 'q') {
      onMenu();
      setAtMenu(true);
    }
  });

  return atMenu ? (
    <Text>main menu</Text>
  ) : (
    <Box flexDirection="column">
      <MiotProviderDetails provider={provider} onBack={onBack} />
      <Text>q menu</Text>
    </Box>
  );
}

function createAuthorizationProvider(authorization: {
  readonly cancel: () => Promise<void>;
  readonly submitCallbackUrl: (callbackUrl: string) => Promise<void>;
  readonly wait: () => Promise<void>;
}): MiotProvider {
  const provider = new MiotProvider('terminal-authorization-test');

  Object.defineProperties(provider.configuration, {
    load: {
      configurable: true,
      value: () => Promise.resolve(undefined),
    },
    beginAuthorization: {
      configurable: true,
      value: () =>
        Promise.resolve({
          url: AUTHORIZATION_URL,
          ...authorization,
        }),
    },
  });

  return provider;
}

function createReadyProvider(operations: {
  readonly load: () => Promise<MiotProviderConfigurationSnapshot>;
  readonly saveIncludedHomes: (
    account: MiotProviderAccount,
    homes: readonly MiotProviderHomeReference[],
  ) => Promise<void>;
}): MiotProvider {
  const provider = new MiotProvider('terminal-ready-test');

  Object.defineProperties(provider.configuration, {
    load: {configurable: true, value: operations.load},
    saveIncludedHomes: {
      configurable: true,
      value: operations.saveIncludedHomes,
    },
  });

  return provider;
}

async function openAuthorization(terminal: TestTerminal): Promise<void> {
  await terminal.flushUntil(frame => frame.includes('authorization required'));
  await terminal.input('\r');
  await terminal.flushUntil(frame =>
    frame.includes('paste callback URL · esc cancel'),
  );

  expect(terminal.frame()).toContain(AUTHORIZATION_URL);
}

function createDeferred<T>(): Deferred<T> {
  let resolve: (value: T | PromiseLike<T>) => void = () => undefined;
  let reject: (reason?: unknown) => void = () => undefined;
  const promise = new Promise<T>((resolveValue, rejectValue) => {
    resolve = resolveValue;
    reject = rejectValue;
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
    const output = String(chunk)
      .replaceAll('\u001B[?2004h', '')
      .replaceAll('\u001B[?2004l', '');

    if (output.length > 0) {
      frame = output;
    }
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
    paste: async value => {
      stdin.write(`\u001B[200~${value}\u001B[201~`);
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
  readonly flushUntil: (predicate: (frame: string) => boolean) => Promise<void>;
  readonly input: (value: string) => Promise<void>;
  readonly paste: (value: string) => Promise<void>;
  readonly close: () => Promise<void>;
};

function delay(milliseconds: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, milliseconds);
  });
}
