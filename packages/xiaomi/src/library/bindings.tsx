import {
  type EndpointPath,
  type ProviderBindingComponentProps,
  type ProviderBindingEndpoint,
  type ProviderBindingRequest,
  getEndpointPathKey,
  registerProviderBindingComponent,
} from '@homelib/core';
import {Box, Text, useInput} from 'ink';
import {useCallback, useEffect, useRef, useState} from 'react';

import type {BackendDevice} from './backend/index.js';
import {
  type MiotBindingDeviceCandidate,
  type MiotBindingDeviceDraft,
  type MiotBindingDeviceProposal,
  type MiotBindingDiscovery,
  type MiotBindingEndpointCandidate,
  type MiotBindingEndpointProposal,
  type MiotBindingServiceCandidate,
  discoverMiotBindingDevices,
  resolveMiotBindingDeviceProposal,
} from './binding.js';
import {
  MiotEndpointConnectionMetadata,
  getMiotEndpointConnectionResourceKey,
} from './endpoint-connection.js';
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

  const saveBindings = (
    source: DeviceMatchState,
    requests: readonly ProviderBindingRequest[],
  ): void => {
    if (requests.length === 0) {
      onBack();
      return;
    }

    const operation = {};

    operationReference.current = operation;
    setState({type: 'saving', source, requests});
    void onBind(requests).then(
      () => {
        if (operationReference.current !== operation) {
          return;
        }

        operationReference.current = undefined;
        onBack();
      },
      error => {
        if (operationReference.current !== operation) {
          return;
        }

        operationReference.current = undefined;
        setState({
          type: 'save-error',
          source,
          requests,
          message: getErrorMessage(error),
        });
      },
    );
  };

  const prepareSave = (source: DeviceMatchState): void => {
    const proposal = getProposal(source, providerBindings);
    const requests = proposal.bindings.map(({endpoint, metadata}) => ({
      endpoint,
      metadata,
      replaceExisting:
        findCandidateEndpoint(proposal.device, endpoint)?.endpoint.binding !==
          undefined && !hasProviderBinding(endpoint, providerBindings),
    }));

    if (requests.length === 0) {
      const hasExistingBinding = proposal.endpoints.some(
        endpoint => endpoint.status === 'existing',
      );

      if (hasExistingBinding) {
        onBack();
      }

      return;
    }

    if (requests.some(request => request.replaceExisting)) {
      setState({type: 'confirm-save', source, requests});
    } else {
      saveBindings(source, requests);
    }
  };

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
            type: 'device-match',
            discovery: state.discovery,
            deviceKey: selectedDevice.key,
            draft: {},
          });
        }
      } else if (input === 'r') {
        load();
      }
    } else if (state.type === 'device-match') {
      const proposal = getProposal(state, providerBindings);
      const canFinish =
        proposal.bindings.length > 0 ||
        proposal.endpoints.some(endpoint => endpoint.status === 'existing');

      if (key.escape) {
        setState({
          type: 'devices',
          discovery: state.discovery,
          cursor: getCandidateDeviceIndex(state.discovery, state.deviceKey),
        });
      } else if (input === 'e') {
        setState({type: 'endpoints', source: state, cursor: 0});
      } else if (key.return && canFinish) {
        prepareSave(state);
      }
    } else if (state.type === 'endpoints') {
      const proposal = getProposal(state.source, providerBindings);
      const endpointCount = proposal.endpoints.length;

      if (key.escape) {
        setState(state.source);
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
      } else if (input === 'x') {
        const endpointProposal = proposal.endpoints.at(state.cursor);

        if (endpointProposal !== undefined) {
          setState({
            ...state,
            source: setEndpointDraft(state.source, endpointProposal, {
              type: 'skip',
            }),
          });
        }
      } else if (key.return) {
        const endpointProposal = proposal.endpoints.at(state.cursor);

        if (
          endpointProposal !== undefined &&
          endpointProposal.endpoint.services.length > 0
        ) {
          setState({
            type: 'services',
            source: state,
            endpointPath: endpointProposal.endpoint.endpoint.path,
            cursor: 0,
          });
        }
      }
    } else if (state.type === 'services') {
      const endpoint = findCandidateEndpoint(
        getCandidateDevice(
          state.source.source.discovery,
          state.source.source.deviceKey,
        ),
        state.endpointPath,
      );
      const serviceCount = endpoint?.services.length ?? 0;

      if (key.escape) {
        setState(state.source);
      } else if (key.upArrow && serviceCount > 0) {
        setState({...state, cursor: wrapIndex(state.cursor - 1, serviceCount)});
      } else if (key.downArrow && serviceCount > 0) {
        setState({...state, cursor: wrapIndex(state.cursor + 1, serviceCount)});
      } else if (input === 'x' && endpoint !== undefined) {
        setState({
          ...state.source,
          source: setEndpointDraft(state.source.source, endpoint, {
            type: 'skip',
          }),
        });
      } else if (key.return) {
        const service = endpoint?.services.at(state.cursor);

        if (
          endpoint !== undefined &&
          service !== undefined &&
          canSelectService(state, service, providerBindings)
        ) {
          setState({
            ...state.source,
            source: setEndpointServiceDraft(
              state.source.source,
              endpoint,
              service,
            ),
          });
        }
      }
    } else if (state.type === 'confirm-save') {
      if (key.escape) {
        setState(state.source);
      } else if (input === 'y' || key.return) {
        saveBindings(state.source, state.requests);
      }
    } else if (state.type === 'saving') {
      return;
    } else if (key.escape) {
      setState(state.source);
    } else if (key.return || input === 'r') {
      saveBindings(state.source, state.requests);
    }
  });

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
        <Text>finding matching mi home devices…</Text>
        <Hint>esc back</Hint>
      </Box>
    );
  } else if (state.type === 'load-error') {
    return (
      <ErrorView message={state.message}>enter/r retry · esc back</ErrorView>
    );
  } else if (state.type === 'devices') {
    return <DevicesView providerBindings={providerBindings} state={state} />;
  } else if (state.type === 'device-match') {
    return <DeviceMatchView proposal={getProposal(state, providerBindings)} />;
  } else if (state.type === 'endpoints') {
    return (
      <EndpointsView
        proposal={getProposal(state.source, providerBindings)}
        state={state}
      />
    );
  } else if (state.type === 'services') {
    return <ServicesView providerBindings={providerBindings} state={state} />;
  } else if (state.type === 'confirm-save') {
    const replacementCount = state.requests.filter(
      request => request.replaceExisting,
    ).length;

    return (
      <Box flexDirection="column">
        <Text>
          replace {replacementCount} existing{' '}
          {replacementCount === 1 ? 'binding' : 'bindings'} and match this
          device?
        </Text>
        <Hint>enter/y confirm · esc cancel</Hint>
      </Box>
    );
  } else if (state.type === 'saving') {
    return (
      <Box flexDirection="column">
        <Text>saving device match…</Text>
      </Box>
    );
  }

  return (
    <ErrorView message={state.message}>enter/r retry · esc back</ErrorView>
  );
}

function DevicesView({
  state,
  providerBindings,
}: {
  readonly state: DevicesState;
  readonly providerBindings: BindingViewProps['providerBindings'];
}): React.JSX.Element {
  const {discovery} = state;
  const visibleDevices = getVisibleItems(
    discovery.devices,
    state.cursor,
    PHYSICAL_DEVICE_PAGE_SIZE,
  );

  return (
    <Box flexDirection="column">
      <Text>choose a mi home device</Text>

      <Box flexDirection="column" marginTop={1}>
        {discovery.devices.length === 0 ? (
          <Text dimColor>no matching devices found.</Text>
        ) : (
          visibleDevices.items.map((device, index) => (
            <ListItem
              key={device.key}
              details={getDeviceMatchDetails(device, providerBindings)}
              label={getDeviceLabel(device.device)}
              selected={visibleDevices.startIndex + index === state.cursor}
              sublabel={getDeviceLocation(device.device)}
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
          {discovery.failedDeviceCount} devices could not be checked.
        </Text>
      )}

      {discovery.incompleteDeviceCount === 0 ? null : (
        <Text dimColor>
          {discovery.incompleteDeviceCount} devices do not expose enough
          information.
        </Text>
      )}

      <Hint>
        {discovery.devices.length === 0
          ? 'r reload · esc back'
          : '↑↓ select · enter match device · r reload · esc back'}
      </Hint>
    </Box>
  );
}

function DeviceMatchView({
  proposal,
}: {
  readonly proposal: MiotBindingDeviceProposal;
}): React.JSX.Element {
  const existingCount = proposal.endpoints.filter(
    endpoint => endpoint.status === 'existing',
  ).length;
  const unresolvedCount = proposal.endpoints.filter(endpoint =>
    ['ambiguous', 'missing', 'unavailable'].includes(endpoint.status),
  ).length;
  const canFinish = proposal.bindings.length > 0 || existingCount > 0;

  return (
    <Box flexDirection="column">
      <Text bold>{getDeviceLabel(proposal.device.device)}</Text>
      {getDeviceLocation(proposal.device.device) === undefined ? null : (
        <Text dimColor>{getDeviceLocation(proposal.device.device)}</Text>
      )}

      <Box flexDirection="column" marginTop={1}>
        <Text>device match</Text>
        {proposal.endpoints.map(endpoint => (
          <EndpointProposalRow
            key={getEndpointPathKey(endpoint.endpoint.endpoint.path)}
            proposal={endpoint}
          />
        ))}
      </Box>

      {unresolvedCount === 0 ? null : (
        <Text color="yellow">
          {unresolvedCount}{' '}
          {unresolvedCount === 1 ? 'feature needs' : 'features need'} optional
          endpoint matching.
        </Text>
      )}

      <Box marginTop={1}>
        {proposal.bindings.length > 0 ? (
          <Text bold color="cyan">
            › bind device · {proposal.bindings.length}{' '}
            {proposal.bindings.length === 1 ? 'feature' : 'features'}
          </Text>
        ) : existingCount > 0 ? (
          <Text bold color="cyan">
            › done · already bound
          </Text>
        ) : (
          <Text color="yellow">no automatic matches.</Text>
        )}
      </Box>

      <Hint>
        {canFinish ? 'enter confirm · ' : ''}e endpoint matching · esc choose
        another device
      </Hint>
    </Box>
  );
}

function EndpointProposalRow({
  proposal,
}: {
  readonly proposal: MiotBindingEndpointProposal;
}): React.JSX.Element {
  let symbol: string;
  let color: 'green' | 'cyan' | 'yellow' | undefined;
  let status: string;
  let serviceLabel: string | undefined;

  if (proposal.status === 'automatic') {
    symbol = '●';
    color = 'green';
    status = 'matched automatically';
    serviceLabel = proposal.service.label;
  } else if (proposal.status === 'manual') {
    symbol = '●';
    color = 'cyan';
    status = 'selected';
    serviceLabel = proposal.service.label;
  } else if (proposal.status === 'existing') {
    symbol = '●';
    color = 'green';
    status = 'already bound';
    serviceLabel = proposal.service.label;
  } else if (proposal.status === 'ambiguous') {
    symbol = '!';
    color = 'yellow';
    status = `${proposal.services.length} possible matches`;
  } else if (proposal.status === 'unavailable') {
    symbol = '!';
    color = 'yellow';
    status = 'matching feature is already used';
  } else if (proposal.status === 'skipped') {
    symbol = '○';
    color = undefined;
    status = 'left unchanged';
  } else {
    symbol = '○';
    color = undefined;
    status = 'not available on this device';
  }

  return (
    <Box>
      <Box width={28}>
        <Text color={color}>
          {symbol} {getEndpointLabel(proposal.endpoint.endpoint)}
        </Text>
      </Box>
      <Text color={color}>{status}</Text>
      {serviceLabel === undefined ? null : (
        <Text dimColor> · {serviceLabel}</Text>
      )}
    </Box>
  );
}

function EndpointsView({
  state,
  proposal,
}: {
  readonly state: EndpointsState;
  readonly proposal: MiotBindingDeviceProposal;
}): React.JSX.Element {
  return (
    <Box flexDirection="column">
      <Text>endpoint matching (optional)</Text>
      <Text dimColor>
        physical device · {getDeviceLabel(proposal.device.device)}
      </Text>

      <Box flexDirection="column" marginTop={1}>
        {proposal.endpoints.map((endpoint, index) => (
          <ListItem
            key={getEndpointPathKey(endpoint.endpoint.endpoint.path)}
            details={getEndpointProposalDetails(endpoint)}
            label={getEndpointLabel(endpoint.endpoint.endpoint)}
            selected={index === state.cursor}
          />
        ))}
      </Box>

      <Hint>↑↓ select · enter choose · x leave unchanged · esc summary</Hint>
    </Box>
  );
}

function ServicesView({
  state,
  providerBindings,
}: {
  readonly state: ServicesState;
  readonly providerBindings: BindingViewProps['providerBindings'];
}): React.JSX.Element {
  const device = getCandidateDevice(
    state.source.source.discovery,
    state.source.source.deviceKey,
  );
  const endpoint = findCandidateEndpoint(device, state.endpointPath);

  if (device === undefined || endpoint === undefined) {
    throw new TypeError('Unknown MIoT binding endpoint.');
  }

  return (
    <Box flexDirection="column">
      <Text>choose a matching feature</Text>
      <Text dimColor>logical · {getEndpointLabel(endpoint.endpoint)}</Text>
      <Text dimColor>physical · {getDeviceLabel(device.device)}</Text>

      <Box flexDirection="column" marginTop={1}>
        {endpoint.services.map((service, index) => {
          const owner = getResourceOwner(
            service,
            providerBindings,
            endpoint.endpoint.path,
          );
          const available = canSelectService(state, service, providerBindings);

          return (
            <ListItem
              key={service.key}
              details={getServiceAvailabilityDetails(available, owner)}
              label={service.label}
              selected={index === state.cursor}
              unavailable={!available}
            />
          );
        })}
      </Box>

      <Hint>↑↓ select · enter choose · x leave unchanged · esc back</Hint>
    </Box>
  );
}

type ListItemProps = {
  readonly label: string;
  readonly sublabel?: string;
  readonly details: string | undefined;
  readonly selected: boolean;
  readonly unavailable?: boolean;
};

function ListItem({
  label,
  sublabel,
  details,
  selected,
  unavailable = false,
}: ListItemProps): React.JSX.Element {
  return (
    <Box>
      <Box width={32}>
        <Text
          bold={selected}
          color={selected ? 'cyan' : undefined}
          dimColor={unavailable}
        >
          {selected ? '› ' : '  '}
          {label}
          {sublabel === undefined ? null : <Text dimColor> · {sublabel}</Text>}
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
  | DeviceMatchState
  | EndpointsState
  | ServicesState
  | ConfirmSaveState
  | SavingState
  | SaveErrorState;

type DevicesState = {
  readonly type: 'devices';
  readonly discovery: MiotBindingDiscovery;
  readonly cursor: number;
};

type DeviceMatchState = {
  readonly type: 'device-match';
  readonly discovery: MiotBindingDiscovery;
  readonly deviceKey: string;
  readonly draft: MiotBindingDeviceDraft;
};

type EndpointsState = {
  readonly type: 'endpoints';
  readonly source: DeviceMatchState;
  readonly cursor: number;
};

type ServicesState = {
  readonly type: 'services';
  readonly source: EndpointsState;
  readonly endpointPath: EndpointPath;
  readonly cursor: number;
};

type ConfirmSaveState = {
  readonly type: 'confirm-save';
  readonly source: DeviceMatchState;
  readonly requests: readonly ProviderBindingRequest[];
};

type SavingState = {
  readonly type: 'saving';
  readonly source: DeviceMatchState;
  readonly requests: readonly ProviderBindingRequest[];
};

type SaveErrorState = {
  readonly type: 'save-error';
  readonly source: DeviceMatchState;
  readonly requests: readonly ProviderBindingRequest[];
  readonly message: string;
};

function getProposal(
  state: DeviceMatchState,
  providerBindings: BindingViewProps['providerBindings'],
): MiotBindingDeviceProposal {
  const device = getCandidateDevice(state.discovery, state.deviceKey);

  if (device === undefined) {
    throw new TypeError('Unknown MIoT binding device.');
  }

  return resolveMiotBindingDeviceProposal(
    device,
    providerBindings,
    state.draft,
  );
}

function setEndpointDraft(
  state: DeviceMatchState,
  endpoint: MiotBindingEndpointCandidate | MiotBindingEndpointProposal,
  draft: MiotBindingDeviceDraft[string],
): DeviceMatchState {
  const candidate = 'status' in endpoint ? endpoint.endpoint : endpoint;
  const endpointPathKey = getEndpointPathKey(candidate.endpoint.path);

  return {...state, draft: {...state.draft, [endpointPathKey]: draft}};
}

function setEndpointServiceDraft(
  state: DeviceMatchState,
  endpoint: MiotBindingEndpointCandidate,
  service: MiotBindingServiceCandidate,
): DeviceMatchState {
  const device = getCandidateDevice(state.discovery, state.deviceKey);
  const nextDraft: Record<string, MiotBindingDeviceDraft[string]> = {
    ...state.draft,
  };

  for (const candidateEndpoint of device?.endpoints ?? []) {
    const candidateEndpointPathKey = getEndpointPathKey(
      candidateEndpoint.endpoint.path,
    );
    const candidateDraft = nextDraft[candidateEndpointPathKey];

    if (candidateDraft?.type !== 'service') {
      continue;
    }

    const candidateService = candidateEndpoint.services.find(
      item => item.key === candidateDraft.serviceKey,
    );

    if (candidateService?.resourceKey === service.resourceKey) {
      delete nextDraft[candidateEndpointPathKey];
    }
  }

  nextDraft[getEndpointPathKey(endpoint.endpoint.path)] = {
    type: 'service',
    serviceKey: service.key,
  };

  return {...state, draft: nextDraft};
}

function getCandidateDevice(
  discovery: MiotBindingDiscovery,
  key: string,
): MiotBindingDeviceCandidate | undefined {
  return discovery.devices.find(device => device.key === key);
}

function getCandidateDeviceIndex(
  discovery: MiotBindingDiscovery,
  key: string,
): number {
  const index = discovery.devices.findIndex(device => device.key === key);

  return index === -1 ? 0 : index;
}

function findCandidateEndpoint(
  device: MiotBindingDeviceCandidate | undefined,
  endpointPath: EndpointPath,
): MiotBindingEndpointCandidate | undefined {
  const endpointPathKey = getEndpointPathKey(endpointPath);

  return device?.endpoints.find(
    endpoint => getEndpointPathKey(endpoint.endpoint.path) === endpointPathKey,
  );
}

function getResourceOwner(
  service: MiotBindingServiceCandidate,
  bindings: BindingViewProps['providerBindings'],
  currentEndpointPath: EndpointPath,
): EndpointPath | undefined {
  for (const binding of bindings) {
    if (endpointPathsEqual(binding.endpoint, currentEndpointPath)) {
      continue;
    }

    try {
      const metadata = MiotEndpointConnectionMetadata.satisfies(
        binding.metadata,
      );

      if (
        getMiotEndpointConnectionResourceKey(metadata) === service.resourceKey
      ) {
        return binding.endpoint;
      }
    } catch {
      continue;
    }
  }

  return undefined;
}

function canSelectService(
  state: ServicesState,
  service: MiotBindingServiceCandidate,
  providerBindings: BindingViewProps['providerBindings'],
): boolean {
  const deviceState = state.source.source;
  const endpoint = findCandidateEndpoint(
    getCandidateDevice(deviceState.discovery, deviceState.deviceKey),
    state.endpointPath,
  );

  if (endpoint === undefined) {
    return false;
  }

  const nextState = setEndpointServiceDraft(deviceState, endpoint, service);
  const endpointPathKey = getEndpointPathKey(endpoint.endpoint.path);
  const proposal = getProposal(nextState, providerBindings).endpoints.find(
    item => getEndpointPathKey(item.endpoint.endpoint.path) === endpointPathKey,
  );

  return proposal?.status === 'manual';
}

function getServiceAvailabilityDetails(
  available: boolean,
  owner: EndpointPath | undefined,
): string | undefined {
  if (available) {
    return undefined;
  } else if (owner === undefined) {
    return 'already selected for another endpoint';
  }

  return `already used by ${formatEndpointPath(owner)}`;
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

function getDeviceLocation(device: BackendDevice): string | undefined {
  const location = [device.homeName, device.roomName]
    .filter(value => value !== undefined)
    .join(' › ');

  if (device.online === false) {
    return location === '' ? 'offline' : `${location} · offline`;
  }

  return location === '' ? undefined : location;
}

function getDeviceMatchDetails(
  device: MiotBindingDeviceCandidate,
  providerBindings: BindingViewProps['providerBindings'],
): string {
  const proposal = resolveMiotBindingDeviceProposal(device, providerBindings);
  const matchedCount = proposal.endpoints.filter(endpoint =>
    ['automatic', 'existing'].includes(endpoint.status),
  ).length;
  const reviewCount = proposal.endpoints.length - matchedCount;

  if (reviewCount === 0) {
    return `${matchedCount} ${matchedCount === 1 ? 'feature' : 'features'} matched`;
  } else if (matchedCount === 0) {
    return `${reviewCount} ${reviewCount === 1 ? 'feature needs' : 'features need'} review`;
  }

  return `${matchedCount} matched · ${reviewCount} need review`;
}

function getEndpointProposalDetails(
  proposal: MiotBindingEndpointProposal,
): string {
  if (proposal.status === 'automatic') {
    return `automatic · ${proposal.service.label}`;
  } else if (proposal.status === 'manual') {
    return `selected · ${proposal.service.label}`;
  } else if (proposal.status === 'existing') {
    return `already bound · ${proposal.service.label}`;
  } else if (proposal.status === 'ambiguous') {
    return `${proposal.services.length} possible matches`;
  } else if (proposal.status === 'unavailable') {
    return 'matching feature already used';
  } else if (proposal.status === 'skipped') {
    return 'left unchanged';
  }

  return 'not available on this device';
}

function getEndpointLabel(endpoint: ProviderBindingEndpoint): string {
  return endpoint.endpoint.name === '' ? 'main' : endpoint.endpoint.name;
}

function formatEndpointPath(path: EndpointPath): string {
  return [...path.scopePath, path.deviceName, path.endpointName]
    .filter(segment => segment !== '')
    .join(' › ');
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
