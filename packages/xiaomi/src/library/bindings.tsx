import {
  type EndpointPath,
  type ProviderBindingComponentProps,
  type ProviderBindingEndpoint,
  getEndpointPathKey,
  registerProviderBindingComponent,
} from '@homelib/core';
import {Box, Text, useInput} from 'ink';
import {useCallback, useEffect, useRef, useState} from 'react';

import type {BackendDevice} from './backend/index.js';
import {
  type MiotBindingDeviceCandidate,
  type MiotBindingDiscovery,
  type MiotBindingEndpointCandidate,
  type MiotBindingServiceCandidate,
  discoverMiotBindingDevices,
} from './binding.js';
import {MiotEndpointConnectionMetadata} from './endpoint-connection.js';
import {MiotProvider} from './provider.js';

const PHYSICAL_DEVICE_PAGE_SIZE = 12;

export function MiotProviderBindings({
  provider,
  device,
  providerBindings,
  onBind,
  onBack,
}: ProviderBindingComponentProps<MiotProvider>): React.JSX.Element {
  const [state, setState] = useState<BindingState>({type: 'loading'});
  const operationReference = useRef<object | undefined>(undefined);
  const deviceReference = useRef(device);
  deviceReference.current = device;

  const load = useCallback((): void => {
    const operation = {};

    operationReference.current = operation;
    setState({type: 'loading'});
    void discoverMiotBindingDevices(
      provider,
      deviceReference.current.endpoints,
    ).then(
      discovery => {
        if (operationReference.current !== operation) {
          return;
        }

        operationReference.current = undefined;
        setState({type: 'devices', discovery, cursor: 0});
      },
      error => {
        if (operationReference.current !== operation) {
          return;
        }

        operationReference.current = undefined;
        setState({type: 'load-error', message: getErrorMessage(error)});
      },
    );
  }, [provider]);

  useEffect(() => {
    load();

    return () => {
      operationReference.current = undefined;
    };
  }, [load]);

  useInput((input, key) => {
    if (state.type === 'loading') {
      if (key.escape) {
        operationReference.current = undefined;
        onBack();
      }
    } else if (state.type === 'load-error') {
      if (key.escape) {
        onBack();
      } else if (key.return || input === 'r') {
        load();
      }
    } else if (state.type === 'devices') {
      const deviceCount = state.discovery.devices.length;

      if (key.escape) {
        onBack();
      } else if (key.upArrow && deviceCount > 0) {
        setState({...state, cursor: wrapIndex(state.cursor - 1, deviceCount)});
      } else if (key.downArrow && deviceCount > 0) {
        setState({...state, cursor: wrapIndex(state.cursor + 1, deviceCount)});
      } else if (key.return) {
        const selectedDevice = state.discovery.devices.at(state.cursor);

        if (selectedDevice !== undefined) {
          setState({
            type: 'endpoints',
            discovery: state.discovery,
            deviceKey: selectedDevice.key,
            cursor: 0,
          });
        }
      } else if (input === 'r') {
        load();
      }
    } else if (state.type === 'endpoints') {
      const selectedDevice = getCandidateDevice(
        state.discovery,
        state.deviceKey,
      );
      const endpointCount = selectedDevice?.endpoints.length ?? 0;

      if (key.escape) {
        setState({type: 'devices', discovery: state.discovery, cursor: 0});
      } else if (key.upArrow && endpointCount > 0) {
        setState({
          ...state,
          cursor: wrapIndex(state.cursor - 1, endpointCount),
        });
      } else if (key.downArrow && endpointCount > 0) {
        setState({
          ...state,
          cursor: wrapIndex(state.cursor + 1, endpointCount),
        });
      } else if (key.return) {
        const endpoint = selectedDevice?.endpoints.at(state.cursor);

        if (endpoint !== undefined) {
          setState({
            type: 'services',
            source: state,
            endpointPath: endpoint.endpoint.path,
            cursor: 0,
          });
        }
      }
    } else if (state.type === 'services') {
      const endpoint = getCandidateEndpoint(
        state.source.discovery,
        state.source.deviceKey,
        state.endpointPath,
      );
      const serviceCount = endpoint?.services.length ?? 0;

      if (key.escape) {
        setState(state.source);
      } else if (key.upArrow && serviceCount > 0) {
        setState({...state, cursor: wrapIndex(state.cursor - 1, serviceCount)});
      } else if (key.downArrow && serviceCount > 0) {
        setState({...state, cursor: wrapIndex(state.cursor + 1, serviceCount)});
      } else if (key.return) {
        const service = endpoint?.services.at(state.cursor);

        if (
          endpoint !== undefined &&
          service !== undefined &&
          getResourceOwner(
            service,
            providerBindings,
            endpoint.endpoint.path,
          ) === undefined
        ) {
          if (
            endpoint.endpoint.binding !== undefined &&
            !hasProviderBinding(endpoint.endpoint.path, providerBindings)
          ) {
            setState({
              type: 'confirm-replace',
              source: state,
              endpoint: endpoint.endpoint,
              service,
            });
          } else {
            saveBinding(state, endpoint.endpoint.path, service.metadata, false);
          }
        }
      }
    } else if (state.type === 'confirm-replace') {
      if (key.escape) {
        setState(state.source);
      } else if (input === 'y') {
        saveBinding(
          state.source,
          state.endpoint.path,
          state.service.metadata,
          true,
        );
      }
    } else if (state.type === 'saving') {
      return;
    } else if (key.escape) {
      setState(state.source);
    } else if (key.return || input === 'r') {
      saveBinding(
        state.source,
        state.action.endpointPath,
        state.action.metadata,
        state.action.replaceExisting,
      );
    }
  });

  const saveBinding = (
    source: ServicesState,
    endpointPath: EndpointPath,
    metadata: MiotEndpointConnectionMetadata,
    replaceExisting: boolean,
  ): void => {
    const operation = {};
    const action = {
      type: 'bind' as const,
      endpointPath,
      metadata,
      replaceExisting,
    };

    operationReference.current = operation;
    setState({type: 'saving', source, action});
    void onBind(endpointPath, metadata, {replaceExisting}).then(
      () => {
        if (operationReference.current !== operation) {
          return;
        }

        operationReference.current = undefined;
        setState({...source.source, notice: 'binding saved.'});
      },
      error => {
        if (operationReference.current !== operation) {
          return;
        }

        operationReference.current = undefined;
        setState({
          type: 'save-error',
          source,
          action,
          message: getErrorMessage(error),
        });
      },
    );
  };

  return <BindingView providerBindings={providerBindings} state={state} />;
}

type BindingViewProps = {
  readonly state: BindingState;
  readonly providerBindings: readonly {
    readonly endpoint: EndpointPath;
    readonly metadata: unknown;
  }[];
};

function BindingView({
  state,
  providerBindings,
}: BindingViewProps): React.JSX.Element {
  if (state.type === 'loading') {
    return (
      <Box flexDirection="column">
        <Text>loading compatible miot devices…</Text>
        <Hint>esc back</Hint>
      </Box>
    );
  } else if (state.type === 'load-error') {
    return (
      <ErrorView message={state.message}>enter/r retry · esc back</ErrorView>
    );
  } else if (state.type === 'devices') {
    return <DevicesView state={state} />;
  } else if (state.type === 'endpoints') {
    return <EndpointsView providerBindings={providerBindings} state={state} />;
  } else if (state.type === 'services') {
    return <ServicesView providerBindings={providerBindings} state={state} />;
  } else if (state.type === 'confirm-replace') {
    const provider = state.endpoint.binding?.provider;

    if (provider === undefined) {
      throw new TypeError('MIoT replacement has no existing binding.');
    }

    return (
      <Box flexDirection="column">
        <Text>
          replace the {provider.namespace} / {provider.name} binding for{' '}
          {getEndpointLabel(state.endpoint)}?
        </Text>
        <Hint>y confirm · esc cancel</Hint>
      </Box>
    );
  } else if (state.type === 'saving') {
    return (
      <Box flexDirection="column">
        <Text>saving binding…</Text>
      </Box>
    );
  }

  return (
    <ErrorView message={state.message}>enter/r retry · esc back</ErrorView>
  );
}

function DevicesView({
  state,
}: {
  readonly state: DevicesState;
}): React.JSX.Element {
  const {discovery} = state;
  const visibleDevices = getVisibleItems(
    discovery.devices,
    state.cursor,
    PHYSICAL_DEVICE_PAGE_SIZE,
  );

  return (
    <Box flexDirection="column">
      <Text>physical devices</Text>

      <Box flexDirection="column" marginTop={1}>
        {discovery.devices.length === 0 ? (
          <Text dimColor>no compatible devices discovered.</Text>
        ) : (
          visibleDevices.items.map((device, index) => (
            <ListItem
              key={device.key}
              details={getDeviceDetails(device.device)}
              label={getDeviceLabel(device.device)}
              selected={visibleDevices.startIndex + index === state.cursor}
            />
          ))
        )}
      </Box>

      {discovery.devices.length <= PHYSICAL_DEVICE_PAGE_SIZE ? null : (
        <Text dimColor>
          {visibleDevices.startIndex + 1}–
          {visibleDevices.startIndex + visibleDevices.items.length} of{' '}
          {discovery.devices.length}
        </Text>
      )}

      {discovery.failedDeviceCount === 0 ? null : (
        <Text color="yellow">
          {discovery.failedDeviceCount} device specs failed to load.
        </Text>
      )}

      {discovery.incompleteDeviceCount === 0 ? null : (
        <Text dimColor>
          {discovery.incompleteDeviceCount} devices have no model or spec.
        </Text>
      )}

      <Hint>
        {discovery.devices.length === 0
          ? 'r reload · esc back'
          : '↑↓ select · enter · r reload · esc back'}
      </Hint>
    </Box>
  );
}

type EndpointsViewProps = {
  readonly state: EndpointsState;
  readonly providerBindings: readonly {
    readonly endpoint: EndpointPath;
    readonly metadata: unknown;
  }[];
};

function EndpointsView({
  state,
  providerBindings,
}: EndpointsViewProps): React.JSX.Element {
  const device = getCandidateDevice(state.discovery, state.deviceKey);

  if (device === undefined) {
    throw new TypeError('Unknown MIoT binding device.');
  }

  return (
    <Box flexDirection="column">
      <Text>
        {getDeviceLabel(device.device)} <Text dimColor>logical endpoints</Text>
      </Text>

      <Box flexDirection="column" marginTop={1}>
        {device.endpoints.map((endpoint, index) => {
          const providerBinding = providerBindings.find(binding =>
            endpointPathsEqual(binding.endpoint, endpoint.endpoint.path),
          );

          return (
            <ListItem
              key={getEndpointPathKey(endpoint.endpoint.path)}
              details={
                providerBinding === undefined
                  ? `${endpoint.services.length} services`
                  : `bound · ${endpoint.services.length} services`
              }
              label={getEndpointLabel(endpoint.endpoint)}
              selected={index === state.cursor}
            />
          );
        })}
      </Box>

      {state.notice === undefined ? null : (
        <Text color="green">{state.notice}</Text>
      )}

      <Hint>↑↓ select · enter · esc back</Hint>
    </Box>
  );
}

type ServicesViewProps = {
  readonly state: ServicesState;
  readonly providerBindings: readonly {
    readonly endpoint: EndpointPath;
    readonly metadata: unknown;
  }[];
};

function ServicesView({
  state,
  providerBindings,
}: ServicesViewProps): React.JSX.Element {
  const device = getCandidateDevice(
    state.source.discovery,
    state.source.deviceKey,
  );
  const endpoint = getCandidateEndpoint(
    state.source.discovery,
    state.source.deviceKey,
    state.endpointPath,
  );

  if (device === undefined || endpoint === undefined) {
    throw new TypeError('Unknown MIoT binding endpoint.');
  }

  return (
    <Box flexDirection="column">
      <Text>
        {getDeviceLabel(device.device)} / {getEndpointLabel(endpoint.endpoint)}
      </Text>

      <Box flexDirection="column" marginTop={1}>
        {endpoint.services.map((service, index) => {
          const owner = getResourceOwner(
            service,
            providerBindings,
            endpoint.endpoint.path,
          );

          return (
            <ListItem
              key={service.key}
              details={
                owner === undefined
                  ? service.details
                  : `used by ${formatEndpointPath(owner)}`
              }
              label={service.label}
              selected={index === state.cursor}
              unavailable={owner !== undefined}
            />
          );
        })}
      </Box>

      <Hint>↑↓ select · enter bind · esc back</Hint>
    </Box>
  );
}

type ListItemProps = {
  readonly label: string;
  readonly details: string | undefined;
  readonly selected: boolean;
  readonly unavailable?: boolean;
};

function ListItem({
  label,
  details,
  selected,
  unavailable = false,
}: ListItemProps): React.JSX.Element {
  return (
    <Box>
      <Box width={34}>
        <Text
          bold={selected}
          color={selected ? 'cyan' : undefined}
          dimColor={unavailable}
        >
          {selected ? '› ' : '  '}
          {label}
        </Text>
      </Box>

      {details === undefined ? null : <Text dimColor>{details}</Text>}
    </Box>
  );
}

function ErrorView({
  message,
  children,
}: {
  readonly message: string;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  return (
    <Box flexDirection="column">
      <Text color="red">{message}</Text>
      <Hint>{children}</Hint>
    </Box>
  );
}

function Hint({
  children,
}: {
  readonly children: React.ReactNode;
}): React.JSX.Element {
  return (
    <Box marginTop={1}>
      <Text dimColor>{children}</Text>
    </Box>
  );
}

type BindingState =
  | {readonly type: 'loading'}
  | {readonly type: 'load-error'; readonly message: string}
  | DevicesState
  | EndpointsState
  | ServicesState
  | ConfirmReplaceState
  | SavingState
  | SaveErrorState;

type DevicesState = {
  readonly type: 'devices';
  readonly discovery: MiotBindingDiscovery;
  readonly cursor: number;
};

type EndpointsState = {
  readonly type: 'endpoints';
  readonly discovery: MiotBindingDiscovery;
  readonly deviceKey: string;
  readonly cursor: number;
  readonly notice?: string;
};

type ServicesState = {
  readonly type: 'services';
  readonly source: EndpointsState;
  readonly endpointPath: EndpointPath;
  readonly cursor: number;
};

type ConfirmReplaceState = {
  readonly type: 'confirm-replace';
  readonly source: ServicesState;
  readonly endpoint: ProviderBindingEndpoint;
  readonly service: MiotBindingServiceCandidate;
};

type SavingState = {
  readonly type: 'saving';
  readonly source: ServicesState;
  readonly action: SaveAction;
};

type SaveErrorState = {
  readonly type: 'save-error';
  readonly source: ServicesState;
  readonly action: SaveAction;
  readonly message: string;
};

type SaveAction = {
  readonly type: 'bind';
  readonly endpointPath: EndpointPath;
  readonly metadata: MiotEndpointConnectionMetadata;
  readonly replaceExisting: boolean;
};

function getCandidateDevice(
  discovery: MiotBindingDiscovery,
  key: string,
): MiotBindingDeviceCandidate | undefined {
  return discovery.devices.find(device => device.key === key);
}

function getCandidateEndpoint(
  discovery: MiotBindingDiscovery,
  deviceKey: string,
  endpointPath: EndpointPath,
): MiotBindingEndpointCandidate | undefined {
  const endpointPathKey = getEndpointPathKey(endpointPath);

  return getCandidateDevice(discovery, deviceKey)?.endpoints.find(
    endpoint => getEndpointPathKey(endpoint.endpoint.path) === endpointPathKey,
  );
}

function getResourceOwner(
  service: MiotBindingServiceCandidate,
  bindings: readonly {
    readonly endpoint: EndpointPath;
    readonly metadata: unknown;
  }[],
  currentEndpointPath: EndpointPath,
): EndpointPath | undefined {
  for (const binding of bindings) {
    if (endpointPathsEqual(binding.endpoint, currentEndpointPath)) {
      continue;
    }

    let metadata: MiotEndpointConnectionMetadata;

    try {
      metadata = MiotEndpointConnectionMetadata.satisfies(binding.metadata);
    } catch {
      continue;
    }

    if (
      metadata.device.did === service.metadata.device.did &&
      metadata.service.iid === service.metadata.service.iid
    ) {
      return binding.endpoint;
    }
  }

  return undefined;
}

function hasProviderBinding(
  endpointPath: EndpointPath,
  bindings: readonly {readonly endpoint: EndpointPath}[],
): boolean {
  return bindings.some(binding =>
    endpointPathsEqual(binding.endpoint, endpointPath),
  );
}

function getDeviceLabel(device: BackendDevice): string {
  return device.name ?? device.model ?? device.did;
}

function getDeviceDetails(device: BackendDevice): string {
  const location = [device.homeName, device.roomName]
    .filter(value => value !== undefined)
    .join(' / ');
  const details = [location, device.model]
    .filter(value => value !== undefined && value !== '')
    .join(' · ');

  if (device.online === false) {
    return details === '' ? 'offline' : `${details} · offline`;
  }

  return details;
}

function getEndpointLabel(endpoint: ProviderBindingEndpoint): string {
  return endpoint.endpoint.name === ''
    ? '(default endpoint)'
    : endpoint.endpoint.name;
}

function formatEndpointPath(path: EndpointPath): string {
  return [...path.scopePath, path.deviceName, path.endpointName]
    .filter(segment => segment !== '')
    .join(' / ');
}

function endpointPathsEqual(left: EndpointPath, right: EndpointPath): boolean {
  return getEndpointPathKey(left) === getEndpointPathKey(right);
}

function wrapIndex(index: number, length: number): number {
  return (index + length) % length;
}

function getVisibleItems<T>(
  items: readonly T[],
  selectedIndex: number,
  pageSize: number,
): {readonly items: readonly T[]; readonly startIndex: number} {
  const maximumStartIndex = Math.max(0, items.length - pageSize);
  const startIndex = Math.min(
    maximumStartIndex,
    Math.max(0, selectedIndex - Math.floor(pageSize / 2)),
  );

  return {
    items: items.slice(startIndex, startIndex + pageSize),
    startIndex,
  };
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

registerProviderBindingComponent(MiotProvider, MiotProviderBindings);
