import {
  type ProviderDetailsComponentProps,
  registerProviderDetailsComponent,
} from '@homelib/core';
import {Box, Text, useInput} from 'ink';
import {useCallback, useEffect, useRef, useState} from 'react';

import {
  CLOUD_SERVERS,
  type CloudServer,
  DEFAULT_CLOUD_SERVER,
} from './backend/index.js';
import type {
  MiotProviderConfigurationSnapshot,
  MiotProviderHomeItem,
} from './configuration.js';
import {MiotProvider} from './provider.js';

const DEFAULT_CLOUD_SERVER_INDEX = CLOUD_SERVERS.indexOf(DEFAULT_CLOUD_SERVER);

export function MiotProviderDetails({
  provider,
  onBack,
}: ProviderDetailsComponentProps<MiotProvider>): React.JSX.Element {
  const [state, setState] = useState<DetailsState>({type: 'loading'});
  const operationReference = useRef<Operation | undefined>(undefined);

  const beginOperation = useCallback((): Operation => {
    operationReference.current?.controller.abort();

    const operation = {
      controller: new AbortController(),
    };

    operationReference.current = operation;
    return operation;
  }, []);

  const isCurrentOperation = useCallback(
    (operation: Operation): boolean =>
      operationReference.current === operation &&
      !operation.controller.signal.aborted,
    [],
  );

  const isCurrentOperationReference = useCallback(
    (operation: Operation): boolean => operationReference.current === operation,
    [],
  );

  const completeOperation = useCallback((operation: Operation): void => {
    if (operationReference.current === operation) {
      operationReference.current = undefined;
    }
  }, []);

  const abortOperation = useCallback((): void => {
    operationReference.current?.controller.abort();
    operationReference.current = undefined;
  }, []);

  const load = useCallback((): void => {
    const operation = beginOperation();

    setState({type: 'loading'});
    void provider.configuration.load(operation.controller.signal).then(
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
          setState(createReadyState(snapshot));
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
  }, [beginOperation, completeOperation, isCurrentOperation, provider]);

  const authorize = useCallback(
    (cloudServer: CloudServer): void => {
      const operation = beginOperation();

      setState({type: 'authorizing', cloudServer});
      void (async () => {
        const authorization = await provider.configuration.beginAuthorization(
          cloudServer,
          operation.controller.signal,
        );

        if (!isCurrentOperation(operation)) {
          return;
        }

        setState({
          type: 'authorizing',
          cloudServer,
          url: authorization.url,
        });

        await authorization.wait();

        if (!isCurrentOperation(operation)) {
          return;
        }

        completeOperation(operation);
        load();
      })()
        .catch(error => {
          if (
            !isCurrentOperationReference(operation) ||
            operation.controller.signal.aborted
          ) {
            return;
          }

          completeOperation(operation);
          setState({
            type: 'authorization-error',
            cloudServer,
            message: getErrorMessage(error),
          });
        })
        .finally(() => {
          if (
            isCurrentOperationReference(operation) &&
            operation.controller.signal.aborted
          ) {
            completeOperation(operation);
            load();
          }
        });
    },
    [
      beginOperation,
      completeOperation,
      isCurrentOperation,
      isCurrentOperationReference,
      load,
      provider,
    ],
  );

  const save = useCallback(
    (readyState: ReadyState): void => {
      const operation = beginOperation();
      const includedHomes = readyState.snapshot.homes
        .filter(home => readyState.draftHomeKeys.has(getHomeKey(home)))
        .map(({source, id}) => ({source, id}));

      setState({...readyState, saving: true, saveError: undefined});
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
            });
          },
        );
    },
    [beginOperation, completeOperation, isCurrentOperation, provider],
  );

  useEffect(() => {
    load();

    return abortOperation;
  }, [abortOperation, load]);

  useInput((input, key) => {
    if (state.type === 'loading') {
      if (key.escape) {
        abortOperation();
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
        operationReference.current?.controller.abort();
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
    } else if (!state.saving) {
      const homeCount = state.snapshot.homes.length;
      const filteringAvailable = state.snapshot.account.userId !== null;

      if (key.escape) {
        onBack();
      } else if (key.upArrow && homeCount > 0) {
        setState({...state, cursor: wrapIndex(state.cursor - 1, homeCount)});
      } else if (key.downArrow && homeCount > 0) {
        setState({...state, cursor: wrapIndex(state.cursor + 1, homeCount)});
      } else if (input === ' ' && homeCount > 0 && filteringAvailable) {
        const home = state.snapshot.homes.at(state.cursor);

        if (home !== undefined) {
          const draftHomeKeys = new Set(state.draftHomeKeys);
          const key = getHomeKey(home);

          if (draftHomeKeys.has(key)) {
            draftHomeKeys.delete(key);
          } else {
            draftHomeKeys.add(key);
          }

          setState({...state, draftHomeKeys, saveError: undefined});
        }
      } else if (key.return && filteringAvailable && needsSave(state)) {
        save(state);
      } else if (input === 'r' && !hasDraftChanges(state)) {
        load();
      }
    }
  });

  return <DetailsView state={state} />;
}

type DetailsViewProps = {
  readonly state: DetailsState;
};

function DetailsView({state}: DetailsViewProps): React.JSX.Element {
  if (state.type === 'loading') {
    return (
      <Box flexDirection="column">
        <Text>loading miot configuration…</Text>
        <Hint>esc back</Hint>
      </Box>
    );
  } else if (state.type === 'authorization-required') {
    return <AuthorizationRequiredView state={state} />;
  } else if (state.type === 'authorizing') {
    return <AuthorizingView state={state} />;
  } else if (state.type === 'cancelling-authorization') {
    return (
      <Box flexDirection="column">
        <Text>cancelling authorization…</Text>
      </Box>
    );
  } else if (state.type === 'load-error') {
    return (
      <ErrorView message={state.message}>
        enter/r retry · a authorize again · esc back
      </ErrorView>
    );
  } else if (state.type === 'authorization-error') {
    return (
      <ErrorView message={state.message}>
        enter/r retry · esc choose region
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
  return (
    <Box flexDirection="column">
      <Text>
        setup <Text dimColor>○ authorization required</Text>
      </Text>

      <Box flexDirection="column" marginTop={1}>
        <Text dimColor>cloud region</Text>
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

      <Hint>↑↓ select · enter authorize · esc back</Hint>
    </Box>
  );
}

type AuthorizingViewProps = {
  readonly state: AuthorizingState;
};

function AuthorizingView({state}: AuthorizingViewProps): React.JSX.Element {
  return (
    <Box flexDirection="column">
      <Text>
        setup <Text color="yellow">● authorizing</Text> · region{' '}
        {state.cloudServer}
      </Text>

      {state.url === undefined ? (
        <Text>starting oauth callback…</Text>
      ) : (
        <Box flexDirection="column" marginTop={1}>
          <Text>open this url in a browser:</Text>
          <Text color="cyan" underline wrap="wrap">
            {state.url}
          </Text>
          <Text>waiting for browser callback…</Text>
        </Box>
      )}

      <Hint>esc cancel</Hint>
    </Box>
  );
}

type ReadyViewProps = {
  readonly state: ReadyState;
};

function ReadyView({state}: ReadyViewProps): React.JSX.Element {
  const selectedCount = state.draftHomeKeys.size;
  const draftChanged = hasDraftChanges(state);
  const saveRequired = needsSave(state);
  const filteringAvailable = state.snapshot.account.userId !== null;

  return (
    <Box flexDirection="column">
      <Text>
        setup <Text color="green">● ready</Text> · region{' '}
        {state.snapshot.account.cloudServer}
      </Text>

      {!filteringAvailable ? (
        <Text color="yellow">
          home filtering is unavailable because this account has no stable id.
        </Text>
      ) : state.snapshot.selectionSource === 'account-mismatch' ? (
        <Text color="yellow">
          saved homes belong to another account; all homes are selected.
        </Text>
      ) : null}

      <Box flexDirection="column" marginTop={1}>
        <Text>
          homes {selectedCount} / {state.snapshot.homes.length} selected
        </Text>

        {state.snapshot.homes.length === 0 ? (
          <Text dimColor>no homes discovered.</Text>
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
        <Text color="red">save failed: {state.saveError}</Text>
      )}

      {state.saving ? (
        <Hint>saving…</Hint>
      ) : !filteringAvailable ? (
        <Hint>↑↓ select · r reload · esc back</Hint>
      ) : draftChanged ? (
        <Hint>↑↓ select · space toggle · enter save · esc discard/back</Hint>
      ) : saveRequired ? (
        <Hint>↑↓ select · space toggle · enter save · r reload · esc back</Hint>
      ) : (
        <Hint>↑↓ select · space toggle · r reload · esc back</Hint>
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
  return (
    <Text bold={selected} color={selected ? 'cyan' : undefined}>
      {selected ? '› ' : '  '}[{included ? 'x' : ' '}] {home.name}{' '}
      <Text dimColor>{getHomeSourceLabel(home.source)}</Text>
    </Text>
  );
}

type ErrorViewProps = {
  readonly children: React.ReactNode;
  readonly message: string;
};

function ErrorView({children, message}: ErrorViewProps): React.JSX.Element {
  return (
    <Box flexDirection="column">
      <Text color="red">error: {message}</Text>
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

type ReadyState = {
  readonly type: 'ready';
  readonly snapshot: MiotProviderConfigurationSnapshot;
  readonly cursor: number;
  readonly savedHomeKeys: ReadonlySet<string>;
  readonly draftHomeKeys: ReadonlySet<string>;
  readonly saving: boolean;
  readonly saveError?: string;
};

type Operation = {
  readonly controller: AbortController;
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

function getHomeSourceLabel(source: MiotProviderHomeItem['source']): string {
  if (source === 'shared-home') {
    return 'shared home';
  } else if (source === 'shared-device') {
    return 'shared device';
  }

  return 'owned';
}

function wrapIndex(index: number, length: number): number {
  return (index + length) % length;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

registerProviderDetailsComponent(MiotProvider, MiotProviderDetails);
