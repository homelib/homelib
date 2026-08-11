import {Box, Text, useInput} from 'ink';
import {useState} from 'react';

import type {EndpointPath, ProviderReference} from '../binding.js';

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
    <Page scriptName={model.scriptName} title="bindings">
      <Box flexDirection="column" marginTop={1}>
        <Text dimColor>{model.staleBindingCount} stale bindings</Text>
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
          <Text dimColor>no root scopes declared.</Text>
        )}
      </Box>

      <Hint>{getBindingsPageHint(hasScopes, model.staleBindingCount > 0)}</Hint>
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
          notice: 'stale binding removed.',
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
    <Page scriptName={model.scriptName} title="bindings / stale">
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
  readonly notice?: string;
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
  if (state.type === 'confirm-remove') {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text>
          {matchingBindingCount === 1
            ? 'remove the stale binding for'
            : `remove all ${matchingBindingCount} stale bindings for`}{' '}
          {formatEndpointPath(state.binding.path)}?
        </Text>
        <Text dimColor>
          {state.binding.provider.namespace} / {state.binding.provider.name}
        </Text>
        <Hint>enter/y confirm · esc cancel · ctrl+c exit</Hint>
      </Box>
    );
  } else if (state.type === 'removing') {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text>removing stale binding…</Text>
      </Box>
    );
  } else if (state.type === 'remove-error') {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text color="red">{state.message}</Text>
        <Hint>enter/r retry · esc back · ctrl+c exit</Hint>
      </Box>
    );
  }

  const cursor = normalizeCursor(state.cursor, bindings.length);

  return (
    <>
      <Box flexDirection="column" marginTop={1}>
        <Text dimColor>{bindings.length} stale bindings</Text>
      </Box>

      <Box flexDirection="column" marginTop={1}>
        {bindings.length === 0 ? (
          <Text dimColor>no stale bindings.</Text>
        ) : (
          bindings.map((binding, index) => (
            <ListItem
              key={getStaleBindingKey(binding, index)}
              details={`${binding.provider.namespace} / ${binding.provider.name}`}
              label={formatEndpointPath(binding.path)}
              selected={index === cursor}
            />
          ))
        )}
      </Box>

      {state.notice === undefined ? null : (
        <Text color="green">{state.notice}</Text>
      )}

      <Hint>
        {bindings.length === 0
          ? 'esc back · ctrl+c exit'
          : '↑↓ select · enter · esc back · ctrl+c exit'}
      </Hint>
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
      title={`bindings / ${model.scope.path.join(' / ')}`}
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
          <Text dimColor>no logical devices declared.</Text>
        )}
      </Box>

      <Hint>
        {hasItems
          ? '↑↓ select · enter · esc back · ctrl+c exit'
          : 'esc back · ctrl+c exit'}
      </Hint>
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
  const [state, setState] = useState<BindingDevicePageState>({
    type: 'providers',
    cursor: 0,
  });
  const hasProviders = model.providers.length > 0;
  const boundEndpoints = getBoundEndpoints(model.device);
  const title = getDevicePageTitle(model.scopePath, model.device.name);

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
          notice: 'binding removed.',
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
  readonly notice?: string;
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
  if (state.type === 'bound-endpoints') {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text>bound endpoints</Text>

        <Box flexDirection="column" marginTop={1}>
          {boundEndpoints.map((endpoint, index) => (
            <ListItem
              key={endpoint.name}
              details={`${endpoint.provider.namespace} / ${endpoint.provider.name}`}
              label={getDisplayName(endpoint.name, '(default endpoint)')}
              selected={index === state.cursor}
            />
          ))}
        </Box>

        <Hint>↑↓ select · enter · esc back · ctrl+c exit</Hint>
      </Box>
    );
  } else if (state.type === 'confirm-unbind') {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text>
          remove the binding for{' '}
          {getDisplayName(state.endpoint.name, '(default endpoint)')}?
        </Text>
        <Text dimColor>
          {state.endpoint.provider.namespace} / {state.endpoint.provider.name}
        </Text>
        <Hint>enter/y confirm · esc cancel · ctrl+c exit</Hint>
      </Box>
    );
  } else if (state.type === 'unbinding') {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text>removing binding…</Text>
      </Box>
    );
  } else if (state.type === 'unbind-error') {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text color="red">{state.message}</Text>
        <Hint>enter/r retry · esc back · ctrl+c exit</Hint>
      </Box>
    );
  }

  const summary = getDeviceSummary(device);
  const hasProviders = providers.length > 0;
  const hasBoundEndpoints = boundEndpoints.length > 0;

  return (
    <>
      <Box flexDirection="column" marginTop={1}>
        <Text dimColor>
          {summary.configuredEndpointCount} bound ·{' '}
          {summary.unconfiguredEndpointCount} unbound
        </Text>
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
          <Text dimColor>no providers declared.</Text>
        )}
      </Box>

      {state.notice === undefined ? null : (
        <Text color="green">{state.notice}</Text>
      )}

      <Hint>{getBindingDeviceHint(hasProviders, hasBoundEndpoints)}</Hint>
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
  const deviceTitle = getDevicePageTitle(model.scopePath, model.deviceName);

  return (
    <Page
      scriptName={model.scriptName}
      title={`${deviceTitle} / ${model.provider.namespace} / ${model.provider.name}`}
    >
      <Box flexDirection="column" marginTop={1}>
        {children}
      </Box>
    </Page>
  );
}

export type BindingSummary = {
  readonly deviceCount: number;
  readonly configuredEndpointCount: number;
  readonly unconfiguredEndpointCount: number;
};

export function getBindingSummary(
  scopes: readonly BindingScopeItem[],
): BindingSummary {
  let deviceCount = 0;
  let configuredEndpointCount = 0;
  let unconfiguredEndpointCount = 0;

  for (const scope of scopes) {
    deviceCount += scope.devices.length;

    for (const device of scope.devices) {
      const deviceSummary = getDeviceSummary(device);

      configuredEndpointCount += deviceSummary.configuredEndpointCount;
      unconfiguredEndpointCount += deviceSummary.unconfiguredEndpointCount;
    }

    const childSummary = getBindingSummary(scope.scopes);

    deviceCount += childSummary.deviceCount;
    configuredEndpointCount += childSummary.configuredEndpointCount;
    unconfiguredEndpointCount += childSummary.unconfiguredEndpointCount;
  }

  return {
    deviceCount,
    configuredEndpointCount,
    unconfiguredEndpointCount,
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
  const summary = getBindingSummary([scope]);

  return (
    <ListItem
      details={`${summary.deviceCount} devices · ${summary.configuredEndpointCount} bound · ${summary.unconfiguredEndpointCount} unbound`}
      label={scope.path.join(' / ')}
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
  if (item.type === 'scope') {
    const summary = getBindingSummary([item.scope]);

    return (
      <ListItem
        details={`${summary.deviceCount} devices · ${summary.unconfiguredEndpointCount} unbound`}
        label={`${item.scope.path.at(-1) ?? '(scope)'} /`}
        selected={selected}
      />
    );
  }

  const summary = getDeviceSummary(item.device);

  return (
    <ListItem
      details={`${summary.configuredEndpointCount} bound · ${summary.unconfiguredEndpointCount} unbound`}
      label={getDisplayName(item.device.name, '(default device)')}
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
  const details =
    provider.boundEndpointCount === 0
      ? undefined
      : `${provider.boundEndpointCount} bound`;

  return (
    <ListItem
      details={details}
      label={`${provider.namespace} / ${provider.name}`}
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

function getDeviceSummary(device: BindingDeviceItem): BindingSummary {
  let configuredEndpointCount = 0;
  let unconfiguredEndpointCount = 0;

  for (const endpoint of device.endpoints) {
    if (endpoint.provider !== undefined) {
      configuredEndpointCount++;
    } else {
      unconfiguredEndpointCount++;
    }
  }

  return {
    deviceCount: 1,
    configuredEndpointCount,
    unconfiguredEndpointCount,
  };
}

function getBoundEndpoints(
  device: BindingDeviceItem,
): readonly BoundBindingEndpointItem[] {
  return device.endpoints.filter(
    (endpoint): endpoint is BoundBindingEndpointItem =>
      endpoint.provider !== undefined,
  );
}

function getBindingDeviceHint(
  hasProviders: boolean,
  hasBoundEndpoints: boolean,
): string {
  const actions: string[] = [];

  if (hasProviders) {
    actions.push('↑↓ select', 'enter');
  }

  if (hasBoundEndpoints) {
    actions.push('u unbind');
  }

  actions.push('esc back', 'ctrl+c exit');
  return actions.join(' · ');
}

function getBindingsPageHint(
  hasScopes: boolean,
  hasStaleBindings: boolean,
): string {
  const actions: string[] = [];

  if (hasScopes) {
    actions.push('↑↓ select', 'enter');
  }

  if (hasStaleBindings) {
    actions.push('u stale');
  }

  actions.push('esc back', 'ctrl+c exit');
  return actions.join(' · ');
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

function formatEndpointPath(path: EndpointPath): string {
  return [
    ...path.scopePath,
    getDisplayName(path.deviceName, '(default device)'),
    getDisplayName(path.endpointName, '(default endpoint)'),
  ].join(' / ');
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
): string {
  return `bindings / ${[
    ...scopePath,
    getDisplayName(deviceName, '(default device)'),
  ].join(' / ')}`;
}

function getDisplayName(name: string, fallback: string): string {
  return name === '' ? fallback : name;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
