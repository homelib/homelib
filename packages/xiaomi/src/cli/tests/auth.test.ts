import {
  type AuthCliDependencies,
  type AuthCliPrompt,
  runAuthCli,
} from '../auth.js';

import type {OAuthSession, OAuthSessionAuthorization} from '@homelib/xiaomi';

const SESSION: OAuthSession = {
  uuid: '0123456789abcdef0123456789abcdef',
  cloudServer: 'cn',
  redirectUrl: 'http://homeassistant.local:8123/api/webhook/test',
  expiresAt: '2030-01-01T00:00:00.000Z',
  token: {
    accessToken: 'must-not-be-printed',
    refreshToken: 'must-not-be-printed',
    expiresIn: 3600,
  },
};

test('shows help without starting authorization', async () => {
  const fixture = createFixture();

  await runAuthCli(['--help'], fixture.dependencies);

  expect(fixture.output.join('\n')).toContain(
    'packages/xiaomi/bld/cli/auth.js',
  );
  expect(fixture.beginOptions).toEqual([]);
  expect(fixture.prompt.closed).toBe(false);
});

test('authorizes into the standard development credential paths', async () => {
  const fixture = createFixture({answers: ['  http://callback.test/result  ']});

  await runAuthCli([], fixture.dependencies);

  expect(fixture.beginOptions).toEqual([
    {
      sessionPath: '/environment/providers/miot/development.json',
      uuidPath: '/environment/providers/miot/identity/development.json',
      cloudServer: 'cn',
    },
  ]);
  expect(fixture.submittedCallbackUrls).toEqual([
    'http://callback.test/result',
  ]);
  expect(fixture.prompt.closed).toBe(true);

  const output = fixture.output.join('\n');

  expect(output).toContain('https://example.test/authorize');
  expect(output).toContain('/environment/providers/miot/development.json');
  expect(output).not.toContain('must-not-be-printed');
});

test('accepts custom authorization options and retries a rejected callback', async () => {
  const fixture = createFixture({
    answers: ['', 'invalid', 'accepted'],
    rejectedCallbackUrls: new Set(['invalid']),
  });

  await runAuthCli(
    ['--name', 'agent', '--cloud-server', 'sg', '--directory', './credentials'],
    fixture.dependencies,
  );

  expect(fixture.beginOptions).toEqual([
    {
      sessionPath: `${process.cwd()}/credentials/providers/miot/agent.json`,
      uuidPath: `${process.cwd()}/credentials/providers/miot/identity/agent.json`,
      cloudServer: 'sg',
    },
  ]);
  expect(fixture.submittedCallbackUrls).toEqual(['invalid', 'accepted']);
  expect(fixture.output).toContain('Callback URL is empty. Paste it again.');
  expect(fixture.output).toContain(
    'Callback URL was rejected: rejected callback',
  );
});

test('finishes when the browser callback arrives without pasted input', async () => {
  const fixture = createFixture({completeImmediately: true});

  await runAuthCli([], fixture.dependencies);

  expect(fixture.submittedCallbackUrls).toEqual([]);
  expect(fixture.prompt.abortedQuestionCount).toBe(1);
  expect(fixture.prompt.closed).toBe(true);
});

test.each([
  [
    ['--name', '../escape'],
    'Authorization name must be a non-empty file name.',
  ],
  [['--cloud-server', 'unknown'], 'Unknown Xiaomi cloud server: unknown.'],
] as const)(
  'rejects invalid options before authorization',
  async (args, message) => {
    const fixture = createFixture();

    await expect(runAuthCli(args, fixture.dependencies)).rejects.toThrow(
      message,
    );
    expect(fixture.beginOptions).toEqual([]);
  },
);

type FixtureOptions = {
  readonly answers?: readonly string[];
  readonly rejectedCallbackUrls?: ReadonlySet<string>;
  readonly completeImmediately?: boolean;
};

function createFixture(options: FixtureOptions = {}): {
  readonly dependencies: AuthCliDependencies;
  readonly output: string[];
  readonly beginOptions: BeginOptions[];
  readonly submittedCallbackUrls: string[];
  readonly prompt: TestPrompt;
} {
  const output: string[] = [];
  const beginOptions: BeginOptions[] = [];
  const submittedCallbackUrls: string[] = [];
  const prompt = new TestPrompt(options.answers ?? []);

  return {
    output,
    beginOptions,
    submittedCallbackUrls,
    prompt,
    dependencies: {
      getEnvironmentDirectory: () => '/environment',
      write: value => {
        output.push(value);
      },
      createPrompt: () => prompt,
      beginAuthorization: async beginOptionsValue => {
        beginOptions.push(beginOptionsValue);
        let resolveCompletion: (session: OAuthSession) => void = () =>
          undefined;
        const completion = new Promise<OAuthSession>(resolve => {
          resolveCompletion = resolve;
        });

        if (options.completeImmediately) {
          resolveCompletion(SESSION);
        }

        return {
          url: 'https://example.test/authorize',
          wait: () => completion,
          cancel: async () => undefined,
          submitCallbackUrl: async callbackUrl => {
            submittedCallbackUrls.push(callbackUrl);

            if (options.rejectedCallbackUrls?.has(callbackUrl)) {
              throw new Error('rejected callback');
            }

            resolveCompletion(SESSION);
          },
        } satisfies OAuthSessionAuthorization;
      },
    },
  };
}

type BeginOptions = Parameters<AuthCliDependencies['beginAuthorization']>[0];

class TestPrompt implements AuthCliPrompt {
  closed = false;

  abortedQuestionCount = 0;

  private answerIndex = 0;

  constructor(private readonly answers: readonly string[]) {}

  question(
    _query: string,
    {signal}: {readonly signal: AbortSignal},
  ): Promise<string> {
    const answer = this.answers.at(this.answerIndex++);

    if (answer !== undefined) {
      return Promise.resolve(answer);
    }

    return new Promise((_resolve, reject) => {
      signal.addEventListener(
        'abort',
        () => {
          this.abortedQuestionCount++;
          reject(signal.reason);
        },
        {once: true},
      );
    });
  }

  close(): void {
    this.closed = true;
  }
}
