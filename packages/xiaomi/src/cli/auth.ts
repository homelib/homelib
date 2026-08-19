import {homedir} from 'node:os';
import {join, resolve} from 'node:path';
import {stdin, stdout} from 'node:process';
import {createInterface} from 'node:readline/promises';
import {pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';

import {
  CLOUD_SERVERS,
  type CloudServer,
  DEFAULT_CLOUD_SERVER,
  type OAuthSessionAuthorization,
  beginOAuthSessionAuthorization,
} from '@homelib/xiaomi';

const DEFAULT_AUTHORIZATION_NAME = 'development';

export async function runAuthCli(
  args: readonly string[],
  dependencies: AuthCliDependencies = DEFAULT_DEPENDENCIES,
  signal?: AbortSignal,
): Promise<void> {
  const options = parseAuthCliOptions(args, dependencies);

  if (options.type === 'help') {
    dependencies.write(getHelp());
    return;
  }

  const prompt = dependencies.createPrompt();
  const operation = new AbortController();
  const handleAbort = (): void => {
    operation.abort(signal?.reason);
  };

  if (signal?.aborted) {
    operation.abort(signal.reason);
  } else {
    signal?.addEventListener('abort', handleAbort, {once: true});
  }

  let authorization: OAuthSessionAuthorization | undefined;

  try {
    throwIfAborted(operation.signal);
    dependencies.write(
      `OAuth credentials will be saved to:\n${options.sessionPath}`,
    );
    authorization = await dependencies.beginAuthorization({
      sessionPath: options.sessionPath,
      uuidPath: options.uuidPath,
      cloudServer: options.cloudServer,
    });
    throwIfAborted(operation.signal);

    dependencies.write(
      `Open this URL in a browser to authorize the Xiaomi account:\n${authorization.url}`,
    );
    dependencies.write(
      'If the browser cannot reach the callback page, copy the complete URL from its address bar and paste it below.',
    );

    const completion = authorization.wait();
    const callbackSubmission = submitCallbackUrl(
      authorization,
      prompt,
      dependencies.write,
      operation.signal,
    );

    await Promise.race([completion, callbackSubmission]);
    await completion;
    dependencies.write(
      `Authorization complete. OAuth credentials were saved to:\n${options.sessionPath}`,
    );
  } finally {
    operation.abort();
    signal?.removeEventListener('abort', handleAbort);
    prompt.close();
    await authorization?.cancel().catch(() => undefined);
  }
}

/** @internal */
export type AuthCliDependencies = {
  readonly beginAuthorization: typeof beginOAuthSessionAuthorization;
  readonly createPrompt: () => AuthCliPrompt;
  readonly getEnvironmentDirectory: () => string;
  readonly write: (value: string) => void;
};

/** @internal */
export type AuthCliPrompt = {
  question(
    query: string,
    options: {readonly signal: AbortSignal},
  ): Promise<string>;
  close(): void;
};

type AuthCliOptions =
  | {readonly type: 'help'}
  | {
      readonly type: 'authorize';
      readonly cloudServer: CloudServer;
      readonly sessionPath: string;
      readonly uuidPath: string;
    };

const DEFAULT_DEPENDENCIES: AuthCliDependencies = {
  beginAuthorization: beginOAuthSessionAuthorization,
  createPrompt: () => {
    const prompt = createInterface({input: stdin, output: stdout});

    return {
      question: (query, options) => prompt.question(query, options),
      close: () => {
        prompt.close();
      },
    };
  },
  getEnvironmentDirectory: () =>
    process.env.HOMELIB_DIRECTORY ?? join(homedir(), '.homelib'),
  write: value => {
    console.info(value);
  },
};

function parseAuthCliOptions(
  args: readonly string[],
  dependencies: AuthCliDependencies,
): AuthCliOptions {
  const {values} = parseArgs({
    args,
    options: {
      help: {type: 'boolean', short: 'h'},
      name: {type: 'string', short: 'n'},
      'cloud-server': {type: 'string', short: 's'},
      directory: {type: 'string', short: 'd'},
    },
    strict: true,
    allowPositionals: false,
  });

  if (values.help === true) {
    return {type: 'help'};
  }

  const name = values.name ?? DEFAULT_AUTHORIZATION_NAME;
  const cloudServer = values['cloud-server'] ?? DEFAULT_CLOUD_SERVER;

  assertAuthorizationName(name);

  if (!isCloudServer(cloudServer)) {
    throw new TypeError(`Unknown Xiaomi cloud server: ${cloudServer}.`);
  }

  const environmentDirectory = resolve(
    values.directory ?? dependencies.getEnvironmentDirectory(),
  );
  const providerDirectory = join(environmentDirectory, 'providers', 'miot');

  return {
    type: 'authorize',
    cloudServer,
    sessionPath: join(providerDirectory, `${name}.json`),
    uuidPath: join(providerDirectory, 'identity', `${name}.json`),
  };
}

async function submitCallbackUrl(
  authorization: OAuthSessionAuthorization,
  prompt: AuthCliPrompt,
  write: (value: string) => void,
  signal: AbortSignal,
): Promise<void> {
  while (true) {
    const callbackUrl = (
      await prompt.question('Complete callback URL: ', {signal})
    ).trim();

    if (callbackUrl.length === 0) {
      write('Callback URL is empty. Paste it again.');
      continue;
    }

    try {
      await authorization.submitCallbackUrl(callbackUrl);
      return;
    } catch (error) {
      write(`Callback URL was rejected: ${getErrorMessage(error)}`);
    }
  }
}

function assertAuthorizationName(name: string): void {
  if (
    name.length === 0 ||
    name === '.' ||
    name === '..' ||
    name.includes('/') ||
    name.includes('\\') ||
    name.includes('\0')
  ) {
    throw new TypeError('Authorization name must be a non-empty file name.');
  }
}

function isCloudServer(value: string): value is CloudServer {
  return (CLOUD_SERVERS as readonly string[]).includes(value);
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw signal.reason;
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getHelp(): string {
  return `Usage: node packages/xiaomi/bld/cli/auth.js [options]

Authorize a Xiaomi account and save its OAuth credentials in a file readable only by the current user.

Options:
  -n, --name <name>          Authorization name (default: ${DEFAULT_AUTHORIZATION_NAME})
  -s, --cloud-server <name>  Xiaomi cloud server (default: ${DEFAULT_CLOUD_SERVER})
                              One of: ${CLOUD_SERVERS.join(', ')}
  -d, --directory <path>     HomeLib data directory
                              Default: HOMELIB_DIRECTORY or ~/.homelib
  -h, --help                 Show this help`;
}

function isMainModule(): boolean {
  const scriptPath = process.argv.at(1);

  return (
    scriptPath !== undefined &&
    pathToFileURL(resolve(scriptPath)).href === import.meta.url
  );
}

if (isMainModule()) {
  const cancellation = new AbortController();
  const handleInterrupt = (): void => {
    cancellation.abort(new Error('Authorization cancelled.'));
  };

  process.once('SIGINT', handleInterrupt);

  try {
    await runAuthCli(
      process.argv.slice(2),
      DEFAULT_DEPENDENCIES,
      cancellation.signal,
    );
  } catch (error) {
    console.error(`error: ${getErrorMessage(error)}`);
    process.exitCode = cancellation.signal.aborted ? 130 : 1;
  } finally {
    process.removeListener('SIGINT', handleInterrupt);
  }
}
