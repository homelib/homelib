import type {EndpointPath, ProviderReference} from '@homelib/core';
import {Box, Text, useInput} from 'ink';
import {useState} from 'react';

import {useTerminalI18n} from '../@i18n.js';

export type BindingEndpointItem = {
  readonly path: EndpointPath;
  readonly name: string;
  readonly provider: ProviderReference | undefined;
};

export type BindingDeviceItem = {
  readonly name: string;
  readonly endpoints: readonly BindingEndpointItem[];
};

export type BindingScopeItem = {
  readonly path: readonly string[];
  readonly scopes: readonly BindingScopeItem[];
  readonly devices: readonly BindingDeviceItem[];
};

export type BindingsPageModel = {
  readonly scriptName: string;
  readonly scopes: readonly BindingScopeItem[];
  readonly staleBindingCount: number;
};

export type BindingsPageProps = {
  readonly model: BindingsPageModel;
  readonly onBack: () => void;
  readonly onSelect: (scope: BindingScopeItem) => void;
  readonly onSelectStaleBindings: () => void;
};

export function BindingsPage({
  model,
  onBack,
  onSelect,
  onSelectStaleBindings,
}: BindingsPageProps): React.JSX.Element {
  const messages = useTerminalI18n();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const hasScopes = model.scopes.length > 0;

  useInput((input, key) => {
    if (key.escape) {
      onBack();
    } else if (key.upArrow && hasScopes) {
      setSelectedIndex(index =>
        index === 0 ? model.scopes.length - 1 : index - 1,
      );
    } else if (key.downArrow && hasScopes) {
      setSelectedIndex(index =>
        index === model.scopes.length - 1 ? 0 : index + 1,
      );
    } else if (key.return) {
      const scope = model.scopes.at(selectedIndex);

      if (scope !== undefined) {
        onSelect(scope);
      }
    } else if (input === 'u' && model.staleBindingCount > 0) {
      onSelectStaleBindings();
    }
  });

  return (
    <Page scriptName={model.scriptName} title={messages.common.bindings}>
      <Box flexDirection="column" marginTop={1}>
        <Text dimColor>
          {messages.bindings.staleCount(model.staleBindingCount)}
        </Text>
      </Box>

      <Box flexDirection="column" marginTop={1}>
        {hasScopes ? (
          model.scopes.map((scope, index) => (
            <ScopeItem
              key={getScopeKey(scope)}
              scope={scope}
              selected={index === selectedIndex}
            />
          ))
        ) : (
          <Text dimColor>{messages.bindings.noRootScopes}</Text>
        )}
      </Box>

      <Hint>
        {messages.bindings.listHint(hasScopes, model.staleBindingCount > 0)}
      </Hint>
    </Page>
  );
}

export type StaleBindingItem = {
  readonly path: EndpointPath;
  readonly provider: ProviderReference;
};

export type StaleBindingsPageProps = {
  readonly model: {
    readonly scriptName: string;
    readonly bindings: readonly StaleBindingItem[];
  };
  readonly onBack: () => void;
  readonly onRemove: (binding: StaleBindingItem) => Promise<void>;
};

export function StaleBindingsPage({
  model,
  onBack,
  onRemove,
}: StaleBindingsPageProps): React.JSX.Element {
  const messages = useTerminalI18n();
  const [state, setState] = useState<StaleBindingsPageState>({
    type: 'bindings',
    cursor: 0,
  });
  const hasBindings = model.bindings.length > 0;

  useInput((input, key) => {
    if (state.type === 'bindings') {
      const cursor = normalizeCursor(state.cursor, model.bindings.length);

      if (key.escape) {
        onBack();
      } else if (key.upArrow && hasBindings) {
        setState({
          ...state,
          cursor: cursor === 0 ? model.bindings.length - 1 : cursor - 1,
        });
      } else if (key.downArrow && hasBindings) {
        setState({
          ...state,
          cursor: cursor === model.bindings.length - 1 ? 0 : cursor + 1,
        });
      } else if (key.return) {
        const binding = model.bindings.at(cursor);

        if (binding !== undefined) {
          setState({type: 'confirm-remove', source: state, binding});
        }
      }
    } else if (state.type === 'confirm-remove') {
      if (key.escape) {
        setState(state.source);
      } else if (key.return || input === 'y') {
        saveRemoval(state.source, state.binding);
      }
    } else if (state.type === 'removing') {
      return;
    } else if (key.escape) {
      setState(state.source);
    } else if (key.return || input === 'r') {
      saveRemoval(state.source, state.binding);
    }
  });

  const saveRemoval = (
    source: StaleBindingsState,
    binding: StaleBindingItem,
  ): void => {
    setState({type: 'removing', source, binding});
    void onRemove(binding).then(
      () => {
        setState({
          type: 'bindings',
          cursor: source.cursor,
          notice: 'removed',
        });
      },
      error => {
        setState({
          type: 'remove-error',
          source,
          binding,
          message: getErrorMessage(error),
        });
      },
    );
  };

  const matchingBindingCount =
    state.type === 'confirm-remove' ||
    state.type === 'removing' ||
    state.type === 'remove-error'
      ? countBindingsForPath(model.bindings, state.binding.path)
      : 0;

  return (
    <Page
      scriptName={model.scriptName}
      title={`${messages.common.bindings} › ${messages.bindings.staleTitle}`}
    >
      <StaleBindingsView
        bindings={model.bindings}
        matchingBindingCount={matchingBindingCount}
        state={state}
      />
    </Page>
  );
}

type StaleBindingsPageState =
  | StaleBindingsState
  | ConfirmRemoveStaleBindingState
  | RemovingStaleBindingState
  | RemoveStaleBindingErrorState;

type StaleBindingsState = {
  readonly type: 'bindings';
  readonly cursor: number;
  readonly notice?: 'removed';
};

type ConfirmRemoveStaleBindingState = {
  readonly type: 'confirm-remove';
  readonly source: StaleBindingsState;
  readonly binding: StaleBindingItem;
};

type RemovingStaleBindingState = {
  readonly type: 'removing';
  readonly source: StaleBindingsState;
  readonly binding: StaleBindingItem;
};

type RemoveStaleBindingErrorState = {
  readonly type: 'remove-error';
  readonly source: StaleBindingsState;
  readonly binding: StaleBindingItem;
  readonly message: string;
};

type StaleBindingsViewProps = {
  readonly bindings: readonly StaleBindingItem[];
  readonly matchingBindingCount: number;
  readonly state: StaleBindingsPageState;
};

function StaleBindingsView({
  bindings,
  matchingBindingCount,
  state,
}: StaleBindingsViewProps): React.JSX.Element {
  const messages = useTerminalI18n();

  if (state.type === 'confirm-remove') {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text>
          {messages.bindings.confirmRemoveStale(
            matchingBindingCount,
            formatEndpointPath(state.binding.path, messages),
          )}
        </Text>
        <Text dimColor>
          {state.binding.provider.namespace} · {state.binding.provider.name}
        </Text>
        <Hint>{messages.hints.confirm}</Hint>
      </Box>
    );
  } else if (state.type === 'removing') {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text>{messages.bindings.removingStale}</Text>
        <Hint>{messages.hints.busy}</Hint>
      </Box>
    );
  } else if (state.type === 'remove-error') {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text color="red">{messages.common.error(state.message)}</Text>
        <Hint>{messages.hints.retry}</Hint>
      </Box>
    );
  }

  const cursor = normalizeCursor(state.cursor, bindings.length);

  return (
    <>
      <Box flexDirection="column" marginTop={1}>
        <Text dimColor>{messages.bindings.staleCount(bindings.length)}</Text>
      </Box>

      <Box flexDirection="column" marginTop={1}>
        {bindings.length === 0 ? (
          <Text dimColor>{messages.bindings.noStale}</Text>
        ) : (
          bindings.map((binding, index) => (
            <ListItem
              key={getStaleBindingKey(binding, index)}
              details={`${binding.provider.namespace} · ${binding.provider.name}`}
              label={formatEndpointPath(binding.path, messages)}
              selected={index === cursor}
            />
          ))
        )}
      </Box>

      {state.notice === undefined ? null : (
        <Box marginTop={1}>
          <Text color="green">{messages.bindings.staleRemoved}</Text>
        </Box>
      )}

      <Hint>{messages.bindings.staleListHint(bindings.length > 0)}</Hint>
    </>
  );
}

export type BindingScopePageProps = {
  readonly model: {
    readonly scriptName: string;
    readonly scope: BindingScopeItem;
  };
  readonly onBack: () => void;
  readonly onSelectScope: (scope: BindingScopeItem) => void;
  readonly onSelectDevice: (device: BindingDeviceItem) => void;
};

export function BindingScopePage({
  model,
  onBack,
  onSelectScope,
  onSelectDevice,
}: BindingScopePageProps): React.JSX.Element {
  const messages = useTerminalI18n();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const items: readonly BindingScopePageItem[] = [
    ...model.scope.scopes.map(scope => ({type: 'scope' as const, scope})),
    ...model.scope.devices.map(device => ({type: 'device' as const, device})),
  ];
  const hasItems = items.length > 0;

  useInput((_input, key) => {
    if (key.escape) {
      onBack();
    } else if (key.upArrow && hasItems) {
      setSelectedIndex(index => (index === 0 ? items.length - 1 : index - 1));
    } else if (key.downArrow && hasItems) {
      setSelectedIndex(index => (index === items.length - 1 ? 0 : index + 1));
    } else if (key.return) {
      const item = items.at(selectedIndex);

      if (item?.type === 'scope') {
        onSelectScope(item.scope);
      } else if (item?.type === 'device') {
        onSelectDevice(item.device);
      }
    }
  });

  return (
    <Page
      scriptName={model.scriptName}
      title={`${messages.common.bindings} › ${model.scope.path.join(' › ')}`}
    >
      <Box flexDirection="column" marginTop={1}>
        {hasItems ? (
          items.map((item, index) => (
            <BindingScopePageItemView
              key={getBindingScopePageItemKey(item)}
              item={item}
              selected={index === selectedIndex}
            />
          ))
        ) : (
          <Text dimColor>{messages.bindings.noLogicalDevices}</Text>
        )}
      </Box>

      <Hint>{messages.bindings.scopeHint(hasItems)}</Hint>
    </Page>
  );
}

export type BindingProviderItem = {
  readonly namespace: string;
  readonly name: string;
  readonly boundEndpointCount: number;
};

export type BindingDevicePageProps = {
  readonly model: {
    readonly scriptName: string;
    readonly scopePath: readonly string[];
    readonly device: BindingDeviceItem;
    readonly providers: readonly BindingProviderItem[];
  };
  readonly onBack: () => void;
  readonly onSelectProvider: (provider: BindingProviderItem) => void;
  readonly onUnbind: (endpoint: BoundBindingEndpointItem) => Promise<void>;
};

export function BindingDevicePage({
  model,
  onBack,
  onSelectProvider,
  onUnbind,
}: BindingDevicePageProps): React.JSX.Element {
  const messages = useTerminalI18n();
  const [state, setState] = useState<BindingDevicePageState>({
    type: 'providers',
    cursor: 0,
  });
  const hasProviders = model.providers.length > 0;
  const boundEndpoints = getBoundEndpoints(model.device);
  const title = getDevicePageTitle(
    model.scopePath,
    model.device.name,
    messages,
  );

  useInput((input, key) => {
    if (state.type === 'providers') {
      if (key.escape) {
        onBack();
      } else if (key.upArrow && hasProviders) {
        setState({
          ...state,
          cursor:
            state.cursor === 0 ? model.providers.length - 1 : state.cursor - 1,
        });
      } else if (key.downArrow && hasProviders) {
        setState({
          ...state,
          cursor:
            state.cursor === model.providers.length - 1 ? 0 : state.cursor + 1,
        });
      } else if (key.return) {
        const provider = model.providers.at(state.cursor);

        if (provider !== undefined) {
          onSelectProvider(provider);
        }
      } else if (input === 'u' && boundEndpoints.length > 0) {
        setState({
          type: 'bound-endpoints',
          source: state,
          cursor: 0,
        });
      }
    } else if (state.type === 'bound-endpoints') {
      if (key.escape) {
        setState(state.source);
      } else if (key.upArrow && boundEndpoints.length > 0) {
        setState({
          ...state,
          cursor:
            state.cursor === 0 ? boundEndpoints.length - 1 : state.cursor - 1,
        });
      } else if (key.downArrow && boundEndpoints.length > 0) {
        setState({
          ...state,
          cursor:
            state.cursor === boundEndpoints.length - 1 ? 0 : state.cursor + 1,
        });
      } else if (key.return) {
        const endpoint = boundEndpoints.at(state.cursor);

        if (endpoint !== undefined) {
          setState({type: 'confirm-unbind', source: state, endpoint});
        }
      }
    } else if (state.type === 'confirm-unbind') {
      if (key.escape) {
        setState(state.source);
      } else if (key.return || input === 'y') {
        saveUnbinding(state.source, state.endpoint);
      }
    } else if (state.type === 'unbinding') {
      return;
    } else if (key.escape) {
      setState(state.source);
    } else if (key.return || input === 'r') {
      saveUnbinding(state.source, state.endpoint);
    }
  });

  const saveUnbinding = (
    source: BoundEndpointsState,
    endpoint: BoundBindingEndpointItem,
  ): void => {
    setState({type: 'unbinding', source, endpoint});
    void onUnbind(endpoint).then(
      () => {
        setState({
          type: 'providers',
          cursor: source.source.cursor,
          notice: 'removed',
        });
      },
      error => {
        setState({
          type: 'unbind-error',
          source,
          endpoint,
          message: getErrorMessage(error),
        });
      },
    );
  };

  return (
    <Page scriptName={model.scriptName} title={title}>
      <BindingDeviceView
        boundEndpoints={boundEndpoints}
        device={model.device}
        providers={model.providers}
        state={state}
      />
    </Page>
  );
}

type BoundBindingEndpointItem = BindingEndpointItem & {
  readonly provider: ProviderReference;
};

type BindingDevicePageState =
  | ProvidersState
  | BoundEndpointsState
  | ConfirmUnbindState
  | UnbindingState
  | UnbindErrorState;

type ProvidersState = {
  readonly type: 'providers';
  readonly cursor: number;
  readonly notice?: 'removed';
};

type BoundEndpointsState = {
  readonly type: 'bound-endpoints';
  readonly source: ProvidersState;
  readonly cursor: number;
};

type ConfirmUnbindState = {
  readonly type: 'confirm-unbind';
  readonly source: BoundEndpointsState;
  readonly endpoint: BoundBindingEndpointItem;
};

type UnbindingState = {
  readonly type: 'unbinding';
  readonly source: BoundEndpointsState;
  readonly endpoint: BoundBindingEndpointItem;
};

type UnbindErrorState = {
  readonly type: 'unbind-error';
  readonly source: BoundEndpointsState;
  readonly endpoint: BoundBindingEndpointItem;
  readonly message: string;
};

type BindingDeviceViewProps = {
  readonly state: BindingDevicePageState;
  readonly device: BindingDeviceItem;
  readonly providers: readonly BindingProviderItem[];
  readonly boundEndpoints: readonly BoundBindingEndpointItem[];
};

function BindingDeviceView({
  state,
  device,
  providers,
  boundEndpoints,
}: BindingDeviceViewProps): React.JSX.Element {
  const messages = useTerminalI18n();

  if (state.type === 'bound-endpoints') {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text>{messages.bindings.bindingListTitle}</Text>

        <Box flexDirection="column" marginTop={1}>
          {boundEndpoints.map((endpoint, index) => (
            <ListItem
              key={endpoint.name}
              details={
                endpoint.name === ''
                  ? undefined
                  : `${endpoint.provider.namespace} · ${endpoint.provider.name}`
              }
              label={
                endpoint.name === ''
                  ? `${endpoint.provider.namespace} · ${endpoint.provider.name}`
                  : endpoint.name
              }
              selected={index === state.cursor}
            />
          ))}
        </Box>

        <Hint>{messages.bindings.scopeHint(true)}</Hint>
      </Box>
    );
  } else if (state.type === 'confirm-unbind') {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text>
          {messages.bindings.confirmRemoveBinding(
            state.endpoint.name === '' ? undefined : state.endpoint.name,
          )}
        </Text>
        <Text dimColor>
          {state.endpoint.provider.namespace} · {state.endpoint.provider.name}
        </Text>
        <Hint>{messages.hints.confirm}</Hint>
      </Box>
    );
  } else if (state.type === 'unbinding') {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text>{messages.bindings.removingBinding}</Text>
        <Hint>{messages.hints.busy}</Hint>
      </Box>
    );
  } else if (state.type === 'unbind-error') {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text color="red">{messages.common.error(state.message)}</Text>
        <Hint>{messages.hints.retry}</Hint>
      </Box>
    );
  }

  const hasProviders = providers.length > 0;
  const hasBoundEndpoints = boundEndpoints.length > 0;

  return (
    <>
      <Box flexDirection="column" marginTop={1}>
        <Text dimColor>{getDeviceStatus(device, messages)}</Text>
      </Box>

      <Box flexDirection="column" marginTop={1}>
        {hasProviders ? (
          providers.map((provider, index) => (
            <BindingProviderItemView
              key={getProviderKey(provider)}
              provider={provider}
              selected={index === state.cursor}
            />
          ))
        ) : (
          <Text dimColor>{messages.common.noProviders}</Text>
        )}
      </Box>

      {state.notice === undefined ? null : (
        <Box marginTop={1}>
          <Text color="green">{messages.bindings.bindingRemoved}</Text>
        </Box>
      )}

      <Hint>
        {messages.bindings.deviceHint(hasProviders, hasBoundEndpoints)}
      </Hint>
    </>
  );
}

export type BindingProviderPageProps = {
  readonly model: {
    readonly scriptName: string;
    readonly scopePath: readonly string[];
    readonly deviceName: string;
    readonly provider: {
      readonly namespace: string;
      readonly name: string;
    };
  };
  readonly children: React.ReactNode;
};

export function BindingProviderPage({
  model,
  children,
}: BindingProviderPageProps): React.JSX.Element {
  const messages = useTerminalI18n();
  const deviceTitle = getDevicePageTitle(
    model.scopePath,
    model.deviceName,
    messages,
  );

  return (
    <Page scriptName={model.scriptName} title={deviceTitle}>
      <Box flexDirection="column" marginTop={1}>
        <Text dimColor>
          {messages.bindings.matchWith(
            `${model.provider.namespace} · ${model.provider.name}`,
          )}
        </Text>

        <Box flexDirection="column" marginTop={1}>
          {children}
        </Box>

        <Hint>{messages.bindings.providerHint}</Hint>
      </Box>
    </Page>
  );
}

export type BindingSummary = {
  readonly deviceCount: number;
  readonly boundDeviceCount: number;
  readonly unboundDeviceCount: number;
};

export function getBindingSummary(
  scopes: readonly BindingScopeItem[],
): BindingSummary {
  let deviceCount = 0;
  let boundDeviceCount = 0;
  let unboundDeviceCount = 0;

  for (const scope of scopes) {
    deviceCount += scope.devices.length;

    for (const device of scope.devices) {
      if (isDeviceFullyBound(device)) {
        boundDeviceCount++;
      } else {
        unboundDeviceCount++;
      }
    }

    const childSummary = getBindingSummary(scope.scopes);

    deviceCount += childSummary.deviceCount;
    boundDeviceCount += childSummary.boundDeviceCount;
    unboundDeviceCount += childSummary.unboundDeviceCount;
  }

  return {
    deviceCount,
    boundDeviceCount,
    unboundDeviceCount,
  };
}

type BindingScopePageItem =
  | {readonly type: 'scope'; readonly scope: BindingScopeItem}
  | {readonly type: 'device'; readonly device: BindingDeviceItem};

type PageProps = {
  readonly scriptName: string;
  readonly title: string;
  readonly children: React.ReactNode;
};

function Page({scriptName, title, children}: PageProps): React.JSX.Element {
  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold>homelib · {scriptName}</Text>

      <Box marginTop={1}>
        <Text bold>{title}</Text>
      </Box>

      {children}
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

type ScopeItemProps = {
  readonly scope: BindingScopeItem;
  readonly selected: boolean;
};

function ScopeItem({scope, selected}: ScopeItemProps): React.JSX.Element {
  const messages = useTerminalI18n();
  const summary = getBindingSummary([scope]);

  return (
    <ListItem
      details={messages.bindings.scopeSummary(
        summary.deviceCount,
        summary.unboundDeviceCount,
      )}
      label={scope.path.join(' › ')}
      selected={selected}
    />
  );
}

type BindingScopePageItemViewProps = {
  readonly item: BindingScopePageItem;
  readonly selected: boolean;
};

function BindingScopePageItemView({
  item,
  selected,
}: BindingScopePageItemViewProps): React.JSX.Element {
  const messages = useTerminalI18n();

  if (item.type === 'scope') {
    const summary = getBindingSummary([item.scope]);

    return (
      <ListItem
        details={messages.bindings.scopeSummary(
          summary.deviceCount,
          summary.unboundDeviceCount,
        )}
        label={`${item.scope.path.at(-1) ?? '(scope)'} /`}
        selected={selected}
      />
    );
  }

  return (
    <ListItem
      details={getDeviceStatus(item.device, messages)}
      label={getDisplayName(item.device.name, messages.bindings.defaultDevice)}
      selected={selected}
    />
  );
}

type BindingProviderItemViewProps = {
  readonly provider: BindingProviderItem;
  readonly selected: boolean;
};

function BindingProviderItemView({
  provider,
  selected,
}: BindingProviderItemViewProps): React.JSX.Element {
  const messages = useTerminalI18n();
  const details =
    provider.boundEndpointCount === 0
      ? undefined
      : messages.bindings.providerBound;

  return (
    <ListItem
      details={details}
      label={`${provider.namespace} · ${provider.name}`}
      selected={selected}
    />
  );
}

type ListItemProps = {
  readonly label: string;
  readonly details: string | undefined;
  readonly selected: boolean;
};

function ListItem({
  label,
  details,
  selected,
}: ListItemProps): React.JSX.Element {
  return (
    <Box>
      <Box width={32}>
        <Text bold={selected} color={selected ? 'cyan' : undefined}>
          {selected ? '› ' : '  '}
          {label}
        </Text>
      </Box>

      {details === undefined ? null : <Text dimColor>{details}</Text>}
    </Box>
  );
}

function getBoundEndpoints(
  device: BindingDeviceItem,
): readonly BoundBindingEndpointItem[] {
  return device.endpoints.filter(
    (endpoint): endpoint is BoundBindingEndpointItem =>
      endpoint.provider !== undefined,
  );
}

function getDeviceStatus(
  device: BindingDeviceItem,
  messages: ReturnType<typeof useTerminalI18n>,
): string {
  const boundCount = device.endpoints.filter(
    endpoint => endpoint.provider !== undefined,
  ).length;

  return messages.bindings.deviceStatus(boundCount, device.endpoints.length);
}

function isDeviceFullyBound(device: BindingDeviceItem): boolean {
  return (
    device.endpoints.length > 0 &&
    device.endpoints.every(endpoint => endpoint.provider !== undefined)
  );
}

function normalizeCursor(cursor: number, itemCount: number): number {
  return itemCount === 0 ? 0 : Math.min(cursor, itemCount - 1);
}

function countBindingsForPath(
  bindings: readonly StaleBindingItem[],
  path: EndpointPath,
): number {
  const pathKey = getEndpointPathKey(path);

  return bindings.filter(
    binding => getEndpointPathKey(binding.path) === pathKey,
  ).length;
}

function getStaleBindingKey(binding: StaleBindingItem, index: number): string {
  return JSON.stringify([
    binding.path.scopePath,
    binding.path.deviceName,
    binding.path.endpointName,
    binding.provider.namespace,
    binding.provider.name,
    index,
  ]);
}

function getEndpointPathKey(path: EndpointPath): string {
  return JSON.stringify([path.scopePath, path.deviceName, path.endpointName]);
}

function formatEndpointPath(
  path: EndpointPath,
  messages: ReturnType<typeof useTerminalI18n>,
): string {
  const parts = [
    ...path.scopePath,
    getDisplayName(path.deviceName, messages.bindings.defaultDevice),
  ];

  if (path.endpointName !== '') {
    parts.push(path.endpointName);
  }

  return parts.join(' › ');
}

function getScopeKey(scope: BindingScopeItem): string {
  return JSON.stringify(scope.path);
}

function getBindingScopePageItemKey(item: BindingScopePageItem): string {
  if (item.type === 'scope') {
    return `scope:${getScopeKey(item.scope)}`;
  }

  return `device:${item.device.name}`;
}

function getProviderKey(provider: BindingProviderItem): string {
  return JSON.stringify([provider.namespace, provider.name]);
}

function getDevicePageTitle(
  scopePath: readonly string[],
  deviceName: string,
  messages: ReturnType<typeof useTerminalI18n>,
): string {
  return `${messages.common.bindings} › ${[
    ...scopePath,
    getDisplayName(deviceName, messages.bindings.defaultDevice),
  ].join(' › ')}`;
}

function getDisplayName(name: string, fallback: string): string {
  return name === '' ? fallback : name;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
