import {type ProviderDetailsComponentProps} from '@homelib/terminal';
import {Box, Text, useInput, usePaste} from 'ink';
import {useCallback, useEffect, useRef, useState} from 'react';

import {
  CLOUD_SERVERS,
  type CloudServer,
  DEFAULT_CLOUD_SERVER,
} from '../backend/index.js';
import type {
  MiotProviderConfigurationSnapshot,
  MiotProviderHomeItem,
} from '../configuration.js';
import type {MiotProvider} from '../provider.js';

import {useMiotTerminalI18n} from './@i18n.js';

const DEFAULT_CLOUD_SERVER_INDEX = CLOUD_SERVERS.indexOf(DEFAULT_CLOUD_SERVER);

export function MiotProviderDetails({
  provider,
  onBack,
}: ProviderDetailsComponentProps<MiotProvider>): React.JSX.Element {
  const messages = useMiotTerminalI18n();
  const [state, setState] = useState<DetailsState>({type: 'loading'});
  const operationReference = useRef<Operation | undefined>(undefined);

  const beginOperation = useCallback((): Operation => {
    const operation = {authorizationCancellationRequested: false};

    operationReference.current = operation;
    return operation;
  }, []);

  const isCurrentOperation = useCallback(
    (operation: Operation): boolean => operationReference.current === operation,
    [],
  );

  const completeOperation = useCallback((operation: Operation): void => {
    if (operationReference.current === operation) {
      operationReference.current = undefined;
    }
  }, []);

  const clearOperation = useCallback((): void => {
    const operation = operationReference.current;

    operationReference.current = undefined;

    if (
      operation !== undefined &&
      !operation.authorizationCancellationRequested
    ) {
      operation.authorizationCancellationRequested = true;
      void operation.cancelAuthorization?.().catch(console.error);
    }
  }, []);

  const load = useCallback(
    (notice?: ReadyNotice): void => {
      const operation = beginOperation();

      setState({type: 'loading'});
      void provider.configuration.load().then(
        snapshot => {
          if (!isCurrentOperation(operation)) {
            return;
          }

          completeOperation(operation);

          if (snapshot === undefined) {
            setState({
              type: 'authorization-required',
              cloudServerIndex: DEFAULT_CLOUD_SERVER_INDEX,
            });
          } else {
            setState({...createReadyState(snapshot), notice});
          }
        },
        error => {
          if (!isCurrentOperation(operation)) {
            return;
          }

          completeOperation(operation);
          setState({type: 'load-error', message: getErrorMessage(error)});
        },
      );
    },
    [beginOperation, completeOperation, isCurrentOperation, provider],
  );

  const authorize = useCallback(
    (cloudServer: CloudServer): void => {
      const operation = beginOperation();

      setState({type: 'authorizing', cloudServer});
      void (async () => {
        const authorization =
          await provider.configuration.beginAuthorization(cloudServer);

        if (!isCurrentOperation(operation)) {
          await authorization.cancel();
          return;
        }

        operation.cancelAuthorization = authorization.cancel;
        operation.submitCallbackUrl = callbackUrl =>
          authorization.submitCallbackUrl(callbackUrl);

        if (operation.authorizationCancellationRequested) {
          await authorization.cancel();
        } else {
          setState({
            type: 'authorizing',
            cloudServer,
            url: authorization.url,
          });
        }

        await authorization.wait();

        if (!isCurrentOperation(operation)) {
          return;
        }

        completeOperation(operation);
        load();
      })().catch(error => {
        if (!isCurrentOperation(operation)) {
          return;
        }

        completeOperation(operation);

        if (operation.authorizationCancellationRequested) {
          load();
        } else {
          setState({
            type: 'authorization-error',
            cloudServer,
            message: getErrorMessage(error),
          });
        }
      });
    },
    [beginOperation, completeOperation, isCurrentOperation, load, provider],
  );

  const submitCallbackUrl = useCallback(
    (value: string): void => {
      if (
        state.type !== 'authorizing' ||
        state.url === undefined ||
        state.callbackStatus !== undefined
      ) {
        return;
      }

      const operation = operationReference.current;
      const submit = operation?.submitCallbackUrl;

      if (operation === undefined || submit === undefined) {
        return;
      }

      const callbackUrl = value.trim();

      if (callbackUrl.length === 0) {
        setState({...state, callbackError: messages.details.emptyCallback});
        return;
      }

      setState({
        ...state,
        callbackStatus: 'submitting',
        callbackError: undefined,
      });
      void submit(callbackUrl).then(
        () => {
          if (
            !isCurrentOperation(operation) ||
            operation.authorizationCancellationRequested
          ) {
            return;
          }

          setState(currentState => {
            return currentState.type === 'authorizing'
              ? {
                  ...currentState,
                  callbackStatus: 'accepted',
                  callbackError: undefined,
                }
              : currentState;
          });
        },
        error => {
          if (
            !isCurrentOperation(operation) ||
            operation.authorizationCancellationRequested
          ) {
            return;
          }

          setState(currentState => {
            return currentState.type === 'authorizing'
              ? {
                  ...currentState,
                  callbackStatus: undefined,
                  callbackError: getErrorMessage(error),
                }
              : currentState;
          });
        },
      );
    },
    [isCurrentOperation, messages.details.emptyCallback, state],
  );

  usePaste(submitCallbackUrl, {
    isActive:
      state.type === 'authorizing' &&
      state.url !== undefined &&
      state.callbackStatus === undefined,
  });

  const save = useCallback(
    (readyState: ReadyState): void => {
      const operation = beginOperation();
      const includedHomes = readyState.snapshot.homes
        .filter(home => readyState.draftHomeKeys.has(getHomeKey(home)))
        .map(({source, id}) => ({source, id}));

      setState({
        ...readyState,
        saving: true,
        saveError: undefined,
        notice: undefined,
      });
      void provider.configuration
        .saveIncludedHomes(readyState.snapshot.account, includedHomes)
        .then(
          () => {
            if (!isCurrentOperation(operation)) {
              return;
            }

            completeOperation(operation);

            const savedHomeKeys = new Set(readyState.draftHomeKeys);
            const snapshot = {
              ...readyState.snapshot,
              selectionSource: 'saved' as const,
              homes: readyState.snapshot.homes.map(home => ({
                ...home,
                included: savedHomeKeys.has(getHomeKey(home)),
              })),
            };

            setState({
              ...readyState,
              snapshot,
              savedHomeKeys,
              draftHomeKeys: new Set(savedHomeKeys),
              saving: false,
              saveError: undefined,
              notice: 'saved',
            });
          },
          error => {
            if (!isCurrentOperation(operation)) {
              return;
            }

            completeOperation(operation);
            setState({
              ...readyState,
              saving: false,
              saveError: getErrorMessage(error),
              notice: undefined,
            });
          },
        );
    },
    [beginOperation, completeOperation, isCurrentOperation, provider],
  );

  const logOut = useCallback(
    (readyState: ReadyState): void => {
      const operation = beginOperation();

      setState({type: 'logging-out'});
      void provider.configuration.forgetAuthorization().then(
        () => {
          if (!isCurrentOperation(operation)) {
            return;
          }

          completeOperation(operation);
          setState({type: 'logged-out'});
        },
        error => {
          if (!isCurrentOperation(operation)) {
            return;
          }

          completeOperation(operation);
          setState({
            type: 'logout-error',
            readyState,
            message: getErrorMessage(error),
          });
        },
      );
    },
    [beginOperation, completeOperation, isCurrentOperation, provider],
  );

  useEffect(() => {
    load();

    return clearOperation;
  }, [clearOperation, load]);

  useInput((input, key) => {
    if (state.type === 'loading') {
      if (key.escape) {
        clearOperation();
        onBack();
      }
    } else if (state.type === 'authorization-required') {
      if (key.escape) {
        onBack();
      } else if (key.upArrow) {
        setState({
          ...state,
          cloudServerIndex: wrapIndex(
            state.cloudServerIndex - 1,
            CLOUD_SERVERS.length,
          ),
        });
      } else if (key.downArrow) {
        setState({
          ...state,
          cloudServerIndex: wrapIndex(
            state.cloudServerIndex + 1,
            CLOUD_SERVERS.length,
          ),
        });
      } else if (key.return) {
        const cloudServer = CLOUD_SERVERS.at(state.cloudServerIndex);

        if (cloudServer !== undefined) {
          authorize(cloudServer);
        }
      }
    } else if (state.type === 'authorizing') {
      if (key.escape) {
        const operation = operationReference.current;

        if (operation !== undefined) {
          operation.authorizationCancellationRequested = true;
          void operation.cancelAuthorization?.().catch(console.error);
        }

        setState({type: 'cancelling-authorization'});
      }
    } else if (state.type === 'cancelling-authorization') {
      return;
    } else if (state.type === 'load-error') {
      if (key.escape) {
        onBack();
      } else if (key.return || input === 'r') {
        load();
      } else if (input === 'a') {
        setState({
          type: 'authorization-required',
          cloudServerIndex: DEFAULT_CLOUD_SERVER_INDEX,
        });
      }
    } else if (state.type === 'authorization-error') {
      if (key.escape) {
        setState({
          type: 'authorization-required',
          cloudServerIndex: CLOUD_SERVERS.indexOf(state.cloudServer),
        });
      } else if (key.return || input === 'r') {
        authorize(state.cloudServer);
      }
    } else if (state.type === 'logout-confirmation') {
      if (key.escape) {
        setState(state.readyState);
      } else if (input === 'y') {
        logOut(state.readyState);
      }
    } else if (state.type === 'logging-out') {
      return;
    } else if (state.type === 'logged-out') {
      return;
    } else if (state.type === 'logout-error') {
      if (key.escape) {
        setState(state.readyState);
      } else if (key.return || input === 'r') {
        logOut(state.readyState);
      }
    } else if (!state.saving) {
      const homeCount = state.snapshot.homes.length;
      const filteringAvailable = state.snapshot.account.userId !== null;
      const clearedState =
        state.notice === undefined ? state : {...state, notice: undefined};

      if (key.escape) {
        onBack();
      } else if (key.upArrow && homeCount > 0) {
        setState({
          ...clearedState,
          cursor: wrapIndex(state.cursor - 1, homeCount),
        });
      } else if (key.downArrow && homeCount > 0) {
        setState({
          ...clearedState,
          cursor: wrapIndex(state.cursor + 1, homeCount),
        });
      } else if (input === ' ' && homeCount > 0 && filteringAvailable) {
        const home = state.snapshot.homes.at(state.cursor);

        if (home !== undefined) {
          const draftHomeKeys = new Set(clearedState.draftHomeKeys);
          const key = getHomeKey(home);

          if (draftHomeKeys.has(key)) {
            draftHomeKeys.delete(key);
          } else {
            draftHomeKeys.add(key);
          }

          setState({
            ...clearedState,
            draftHomeKeys,
            saveError: undefined,
          });
        }
      } else if (key.return && filteringAvailable && needsSave(state)) {
        save(clearedState);
      } else if (input === 'r' && !hasDraftChanges(state)) {
        load('reloaded');
      } else if (input === 'o') {
        setState({type: 'logout-confirmation', readyState: clearedState});
      } else if (state.notice !== undefined) {
        setState(clearedState);
      }
    }
  });

  return <DetailsView state={state} />;
}

type DetailsViewProps = {
  readonly state: DetailsState;
};

function DetailsView({state}: DetailsViewProps): React.JSX.Element {
  const messages = useMiotTerminalI18n();

  if (state.type === 'loading') {
    return (
      <Box flexDirection="column">
        <Text>{messages.details.loading}</Text>
        <Hint>{messages.bindings.backHint}</Hint>
      </Box>
    );
  } else if (state.type === 'authorization-required') {
    return <AuthorizationRequiredView state={state} />;
  } else if (state.type === 'authorizing') {
    return <AuthorizingView state={state} />;
  } else if (state.type === 'cancelling-authorization') {
    return (
      <Box flexDirection="column">
        <Text>{messages.details.cancellingAuthorization}</Text>
      </Box>
    );
  } else if (state.type === 'load-error') {
    return (
      <ErrorView message={state.message}>
        {messages.details.loadErrorHint}
      </ErrorView>
    );
  } else if (state.type === 'authorization-error') {
    return (
      <ErrorView message={state.message}>
        {messages.details.authorizationErrorHint}
      </ErrorView>
    );
  } else if (state.type === 'logout-confirmation') {
    return <LogoutConfirmationView />;
  } else if (state.type === 'logging-out') {
    return (
      <Box flexDirection="column">
        <Text>{messages.details.loggingOut}</Text>
      </Box>
    );
  } else if (state.type === 'logged-out') {
    return (
      <Box flexDirection="column">
        <Text>{messages.details.loggedOut}</Text>
      </Box>
    );
  } else if (state.type === 'logout-error') {
    return (
      <ErrorView message={state.message}>
        {messages.details.logoutErrorHint}
      </ErrorView>
    );
  }

  return <ReadyView state={state} />;
}

type AuthorizationRequiredViewProps = {
  readonly state: AuthorizationRequiredState;
};

function AuthorizationRequiredView({
  state,
}: AuthorizationRequiredViewProps): React.JSX.Element {
  const messages = useMiotTerminalI18n();

  return (
    <Box flexDirection="column">
      <Text>
        {messages.details.setup}{' '}
        <Text dimColor>{messages.details.authorizationRequired}</Text>
      </Text>

      <Box flexDirection="column" marginTop={1}>
        <Text dimColor>{messages.details.cloudRegion}</Text>
        {CLOUD_SERVERS.map((cloudServer, index) => (
          <Text
            key={cloudServer}
            bold={index === state.cloudServerIndex}
            color={index === state.cloudServerIndex ? 'cyan' : undefined}
          >
            {index === state.cloudServerIndex ? '› ' : '  '}
            {cloudServer}
          </Text>
        ))}
      </Box>

      <Hint>{messages.details.authorizationRequiredHint}</Hint>
    </Box>
  );
}

type AuthorizingViewProps = {
  readonly state: AuthorizingState;
};

function AuthorizingView({state}: AuthorizingViewProps): React.JSX.Element {
  const messages = useMiotTerminalI18n();

  return (
    <Box flexDirection="column">
      <Text>
        {messages.details.setup}{' '}
        <Text color="yellow">{messages.details.authorizing}</Text> ·{' '}
        {messages.details.region} {state.cloudServer}
      </Text>

      {state.url === undefined ? (
        <Text>{messages.details.startingCallback}</Text>
      ) : (
        <Box flexDirection="column" marginTop={1}>
          <Text>{messages.details.openUrl}</Text>
          <Text color="cyan" underline wrap="wrap">
            {state.url}
          </Text>
          {state.callbackStatus === 'submitting' ? (
            <Text>{messages.details.processingCallback}</Text>
          ) : state.callbackStatus === 'accepted' ? (
            <Text>{messages.details.completingAuthorization}</Text>
          ) : (
            <>
              <Text>{messages.details.waitingForCallback}</Text>
              <Text bold color="yellow">
                {messages.details.pasteCallbackHelp}
              </Text>
            </>
          )}
          {state.callbackError === undefined ? null : (
            <Text color="red">
              {messages.details.callbackRejected(state.callbackError)}
            </Text>
          )}
        </Box>
      )}

      <Hint>
        {state.url !== undefined && state.callbackStatus === undefined
          ? messages.details.pasteCallbackHint
          : messages.details.cancelHint}
      </Hint>
    </Box>
  );
}

function LogoutConfirmationView(): React.JSX.Element {
  const messages = useMiotTerminalI18n();

  return (
    <Box flexDirection="column">
      <Text>{messages.details.logoutQuestion}</Text>
      <Text dimColor>{messages.details.logoutDescription}</Text>
      <Hint>{messages.details.logoutHint}</Hint>
    </Box>
  );
}

type ReadyViewProps = {
  readonly state: ReadyState;
};

function ReadyView({state}: ReadyViewProps): React.JSX.Element {
  const messages = useMiotTerminalI18n();
  const selectedCount = state.draftHomeKeys.size;
  const draftChanged = hasDraftChanges(state);
  const saveRequired = needsSave(state);
  const filteringAvailable = state.snapshot.account.userId !== null;

  return (
    <Box flexDirection="column">
      <Text>
        {messages.details.setup}{' '}
        <Text color="green">{messages.details.ready}</Text> ·{' '}
        {messages.details.region} {state.snapshot.account.cloudServer}
      </Text>

      {!filteringAvailable ? (
        <Text color="yellow">{messages.details.filteringUnavailable}</Text>
      ) : state.snapshot.selectionSource === 'account-mismatch' ? (
        <Text color="yellow">{messages.details.accountMismatch}</Text>
      ) : null}

      <Box flexDirection="column" marginTop={1}>
        <Text>
          {messages.details.homesSelected(
            selectedCount,
            state.snapshot.homes.length,
          )}
        </Text>

        {state.snapshot.homes.length === 0 ? (
          <Text dimColor>{messages.details.noHomes}</Text>
        ) : (
          state.snapshot.homes.map((home, index) => (
            <HomeItemView
              key={getHomeKey(home)}
              home={home}
              included={state.draftHomeKeys.has(getHomeKey(home))}
              selected={index === state.cursor}
            />
          ))
        )}
      </Box>

      {state.saveError === undefined ? null : (
        <Text color="red">{messages.details.saveFailed(state.saveError)}</Text>
      )}
      {state.notice === 'saved' ? (
        <Text color="green">{messages.details.saved}</Text>
      ) : state.notice === 'reloaded' ? (
        <Text color="green">{messages.details.reloaded}</Text>
      ) : null}

      {state.saving ? (
        <Hint>{messages.details.saving}</Hint>
      ) : (
        <Hint>
          {messages.details.readyHint(
            filteringAvailable,
            draftChanged,
            saveRequired,
          )}
        </Hint>
      )}
    </Box>
  );
}

type HomeItemViewProps = {
  readonly home: MiotProviderHomeItem;
  readonly included: boolean;
  readonly selected: boolean;
};

function HomeItemView({
  home,
  included,
  selected,
}: HomeItemViewProps): React.JSX.Element {
  const messages = useMiotTerminalI18n();

  return (
    <Text bold={selected} color={selected ? 'cyan' : undefined}>
      {selected ? '› ' : '  '}[{included ? 'x' : ' '}] {home.name}{' '}
      <Text dimColor>{getHomeSourceLabel(home.source, messages)}</Text>
    </Text>
  );
}

type ErrorViewProps = {
  readonly children: React.ReactNode;
  readonly message: string;
};

function ErrorView({children, message}: ErrorViewProps): React.JSX.Element {
  const messages = useMiotTerminalI18n();

  return (
    <Box flexDirection="column">
      <Text color="red">{messages.common.error(message)}</Text>
      <Hint>{children}</Hint>
    </Box>
  );
}

type HintProps = {
  readonly children: React.ReactNode;
};

function Hint({children}: HintProps): React.JSX.Element {
  return (
    <Box marginTop={1}>
      <Text dimColor>{children}</Text>
    </Box>
  );
}

type DetailsState =
  | LoadingState
  | AuthorizationRequiredState
  | AuthorizingState
  | CancellingAuthorizationState
  | LoadErrorState
  | AuthorizationErrorState
  | LogoutConfirmationState
  | LoggingOutState
  | LoggedOutState
  | LogoutErrorState
  | ReadyState;

type LoadingState = {
  readonly type: 'loading';
};

type AuthorizationRequiredState = {
  readonly type: 'authorization-required';
  readonly cloudServerIndex: number;
};

type AuthorizingState = {
  readonly type: 'authorizing';
  readonly cloudServer: CloudServer;
  readonly url?: string;
  readonly callbackStatus?: 'submitting' | 'accepted';
  readonly callbackError?: string;
};

type CancellingAuthorizationState = {
  readonly type: 'cancelling-authorization';
};

type LoadErrorState = {
  readonly type: 'load-error';
  readonly message: string;
};

type AuthorizationErrorState = {
  readonly type: 'authorization-error';
  readonly cloudServer: CloudServer;
  readonly message: string;
};

type LogoutConfirmationState = {
  readonly type: 'logout-confirmation';
  readonly readyState: ReadyState;
};

type LoggingOutState = {
  readonly type: 'logging-out';
};

type LoggedOutState = {
  readonly type: 'logged-out';
};

type LogoutErrorState = {
  readonly type: 'logout-error';
  readonly readyState: ReadyState;
  readonly message: string;
};

type ReadyState = {
  readonly type: 'ready';
  readonly snapshot: MiotProviderConfigurationSnapshot;
  readonly cursor: number;
  readonly savedHomeKeys: ReadonlySet<string>;
  readonly draftHomeKeys: ReadonlySet<string>;
  readonly saving: boolean;
  readonly saveError?: string;
  readonly notice?: ReadyNotice;
};

type ReadyNotice = 'saved' | 'reloaded';

type Operation = {
  authorizationCancellationRequested: boolean;
  cancelAuthorization?: () => Promise<void>;
  submitCallbackUrl?: (callbackUrl: string) => Promise<void>;
};

function createReadyState(
  snapshot: MiotProviderConfigurationSnapshot,
): ReadyState {
  const savedHomeKeys = new Set(
    snapshot.homes.filter(home => home.included).map(getHomeKey),
  );

  return {
    type: 'ready',
    snapshot,
    cursor: 0,
    savedHomeKeys,
    draftHomeKeys: new Set(savedHomeKeys),
    saving: false,
  };
}

function needsSave(state: ReadyState): boolean {
  if (state.snapshot.selectionSource !== 'saved') {
    return true;
  }

  return hasDraftChanges(state);
}

function hasDraftChanges(state: ReadyState): boolean {
  return !setsEqual(state.savedHomeKeys, state.draftHomeKeys);
}

function setsEqual(
  left: ReadonlySet<string>,
  right: ReadonlySet<string>,
): boolean {
  if (left.size !== right.size) {
    return false;
  }

  return [...left].every(value => right.has(value));
}

function getHomeKey(home: Pick<MiotProviderHomeItem, 'source' | 'id'>): string {
  return JSON.stringify([home.source, home.id]);
}

function getHomeSourceLabel(
  source: MiotProviderHomeItem['source'],
  messages: ReturnType<typeof useMiotTerminalI18n>,
): string {
  if (source === 'shared-home') {
    return messages.details.homeSource.sharedHome;
  } else if (source === 'shared-device') {
    return messages.details.homeSource.sharedDevice;
  }

  return messages.details.homeSource.owned;
}

function wrapIndex(index: number, length: number): number {
  return (index + length) % length;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
