import type {OAuthSession} from './session.js';
import {loadValidOAuthSession} from './session.js';

const MAX_REFRESH_MARGIN = 60_000;
const MIN_REFRESH_MARGIN = 1_000;
const INITIAL_RETRY_DELAY = 1_000;
const MAX_RETRY_DELAY = 60_000;
const MAX_TIMER_DELAY = 2_147_483_647;

export class OAuthSessionManager {
  private readonly dependencies: OAuthSessionManagerDependencies;

  private session: OAuthSession | undefined;

  private loadOperation: OAuthSessionLoadOperation | undefined;

  private readonly pendingLoadOperationSet =
    new Set<OAuthSessionLoadOperation>();

  private timer: unknown;

  private generation = 0;

  private retryDelay = INITIAL_RETRY_DELAY;

  constructor(options: OAuthSessionManagerOptions) {
    this.dependencies = {
      loadSession: () => loadValidOAuthSession(options.sessionPath),
      applyAccessToken: options.applyAccessToken,
      now: Date.now,
      setTimer: defaultSetTimer,
      clearTimer: defaultClearTimer,
      reportRefreshFailure: () => {
        console.error('MIoT OAuth token refresh failed; retrying.');
      },
      ...options.dependencies,
    };
  }

  getSession(): Promise<OAuthSession> {
    const session = this.session;

    if (
      session !== undefined &&
      getExpirationTime(session) >
        this.dependencies.now() + getRefreshMargin(session)
    ) {
      return Promise.resolve(session);
    }

    return this.load();
  }

  useSession(session: OAuthSession): void {
    this.generation++;
    this.loadOperation = undefined;
    this.clearRefreshTimer();
    this.acceptSession(session);
  }

  async reset(): Promise<void> {
    this.generation++;
    const pendingLoadOperations = [...this.pendingLoadOperationSet];
    this.loadOperation = undefined;
    this.clearRefreshTimer();
    this.session = undefined;
    this.retryDelay = INITIAL_RETRY_DELAY;

    await Promise.all(
      pendingLoadOperations.map(operation =>
        operation.promise.catch(() => undefined),
      ),
    );
  }

  private load(): Promise<OAuthSession> {
    const generation = this.generation;
    const existingOperation = this.loadOperation;

    if (
      existingOperation !== undefined &&
      existingOperation.generation === generation
    ) {
      return existingOperation.promise;
    }

    const source = this.dependencies.loadSession();
    const promise = source.then(
      session => {
        if (this.generation !== generation) {
          throw new Error('OAuth session load was invalidated.');
        }

        this.acceptSession(session);
        return session;
      },
      error => {
        if (this.generation === generation && this.session !== undefined) {
          this.dependencies.reportRefreshFailure();
          this.scheduleRetry(generation);
        }

        throw error;
      },
    );
    const operation = {generation, promise};
    this.loadOperation = operation;
    this.pendingLoadOperationSet.add(operation);

    void promise.then(
      () => {
        this.completeLoad(operation);
      },
      () => {
        this.completeLoad(operation);
      },
    );
    return promise;
  }

  private completeLoad(operation: OAuthSessionLoadOperation): void {
    this.pendingLoadOperationSet.delete(operation);

    if (this.loadOperation === operation) {
      this.loadOperation = undefined;
    }
  }

  private acceptSession(session: OAuthSession): void {
    getExpirationTime(session);
    this.session = session;
    this.retryDelay = INITIAL_RETRY_DELAY;
    this.dependencies.applyAccessToken(session.token.accessToken);
    this.scheduleRefresh(session, this.generation);
  }

  private scheduleRefresh(session: OAuthSession, generation: number): void {
    const delay = Math.min(
      MAX_TIMER_DELAY,
      Math.max(
        0,
        getExpirationTime(session) -
          this.dependencies.now() -
          getRefreshMargin(session),
      ),
    );

    this.setRefreshTimer(delay, generation);
  }

  private scheduleRetry(generation: number): void {
    const delay = this.retryDelay;
    this.retryDelay = Math.min(this.retryDelay * 2, MAX_RETRY_DELAY);
    this.setRefreshTimer(delay, generation);
  }

  private setRefreshTimer(delay: number, generation: number): void {
    this.clearRefreshTimer();
    this.timer = this.dependencies.setTimer(() => {
      this.timer = undefined;

      if (this.generation === generation) {
        void this.load().catch(() => undefined);
      }
    }, delay);
  }

  private clearRefreshTimer(): void {
    if (this.timer === undefined) {
      return;
    }

    this.dependencies.clearTimer(this.timer);
    this.timer = undefined;
  }
}

export type OAuthSessionManagerOptions = {
  readonly sessionPath: string;
  readonly applyAccessToken: (accessToken: string) => void;
  readonly dependencies?: Partial<OAuthSessionManagerDependencies>;
};

export type OAuthSessionManagerDependencies = {
  readonly loadSession: () => Promise<OAuthSession>;
  readonly applyAccessToken: (accessToken: string) => void;
  readonly now: () => number;
  readonly setTimer: (callback: () => void, delay: number) => unknown;
  readonly clearTimer: (timer: unknown) => void;
  readonly reportRefreshFailure: () => void;
};

type OAuthSessionLoadOperation = {
  readonly generation: number;
  readonly promise: Promise<OAuthSession>;
};

function getExpirationTime(session: OAuthSession): number {
  const expirationTime = Date.parse(session.expiresAt);

  if (Number.isNaN(expirationTime)) {
    throw new Error('OAuth session has an invalid expiration time.');
  }

  return expirationTime;
}

function getRefreshMargin(session: OAuthSession): number {
  return Math.min(
    MAX_REFRESH_MARGIN,
    Math.max(MIN_REFRESH_MARGIN, (session.token.expiresIn * 1_000) / 2),
  );
}

function defaultSetTimer(callback: () => void, delay: number): unknown {
  const timer = setTimeout(callback, delay);

  timer.unref();
  return timer;
}

function defaultClearTimer(timer: unknown): void {
  clearTimeout(timer as ReturnType<typeof setTimeout>);
}
