import {
  type EndpointPath,
  type ProviderBindingRequest,
  getEndpointPathKey,
} from '@homelib/core';
import {type ProviderBindingComponentProps} from '@homelib/terminal';
import {Box, Text, useInput} from 'ink';
import {useCallback, useEffect, useRef, useState} from 'react';

import type {BackendDevice} from '../backend/index.js';
import {
  type MiotBindingDeviceCandidate,
  type MiotBindingDeviceProposal,
  type MiotBindingDiscovery,
  type MiotBindingEndpointCandidate,
  type MiotBindingEndpointProposal,
  type MiotBindingResourceBinding,
  discoverMiotBindingDevices,
  prepareMiotBindingResourceBindings,
  resolveMiotBindingDeviceProposal,
} from '../binding.js';
import type {MiotProvider} from '../provider.js';

const PHYSICAL_DEVICE_PAGE_SIZE = 6;

export function MiotProviderBindings({
  provider,
  device,
  providerBindings,
  onBind,
  onBack,
  onComplete,
}: ProviderBindingComponentProps<MiotProvider>): React.JSX.Element {
  const [state, setState] = useState<BindingState>({type: 'loading'});
  const operationReference = useRef<object | undefined>(undefined);
  const deviceReference = useRef(device);
  const providerBindingsReference = useRef(providerBindings);
  deviceReference.current = device;
  providerBindingsReference.current = providerBindings;

  const load = useCallback(
    (notice?: DevicesState['notice']): void => {
      const operation = {};

      operationReference.current = operation;
      setState({type: 'loading'});
      void Promise.all([
        discoverMiotBindingDevices(provider, deviceReference.current),
        prepareMiotBindingResourceBindings(
          provider,
          providerBindingsReference.current,
        ),
      ]).then(
        ([discovery, preparedProviderBindings]) => {
          if (operationReference.current !== operation) {
            return;
          }

          operationReference.current = undefined;
          setState({
            type: 'devices',
            discovery: {
              ...discovery,
              devices: orderDevicesByLocation(discovery.devices),
            },
            providerBindings: preparedProviderBindings,
            cursor: 0,
            notice,
          });
        },
        error => {
          if (operationReference.current !== operation) {
            return;
          }

          operationReference.current = undefined;
          setState({type: 'load-error', message: getErrorMessage(error)});
        },
      );
    },
    [provider],
  );

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
    const operation = {};

    operationReference.current = operation;
    setState({type: 'saving', source, requests});
    void onBind(requests).then(
      () => {
        if (operationReference.current !== operation) {
          return;
        }

        operationReference.current = undefined;
        onComplete();
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
    const proposal = getProposal(source);

    if (proposal.status === 'unavailable') {
      return;
    } else if (proposal.status === 'existing') {
      onComplete();
      return;
    }

    const requests = proposal.bindings.map(({endpoint, metadata}) => ({
      endpoint,
      metadata,
      replaceExisting:
        findCandidateEndpoint(proposal.device, endpoint)?.endpoint.binding !==
          undefined && !hasProviderBinding(endpoint, source.providerBindings),
    }));

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
      const clearedState =
        state.notice === undefined ? state : {...state, notice: undefined};

      if (key.escape) {
        onBack();
      } else if (key.upArrow && deviceCount > 0) {
        setState({
          ...clearedState,
          cursor: wrapIndex(state.cursor - 1, deviceCount),
        });
      } else if (key.downArrow && deviceCount > 0) {
        setState({
          ...clearedState,
          cursor: wrapIndex(state.cursor + 1, deviceCount),
        });
      } else if (key.return) {
        const selectedDevice = state.discovery.devices.at(state.cursor);

        if (selectedDevice !== undefined) {
          setState({
            type: 'device-match',
            discovery: state.discovery,
            providerBindings: state.providerBindings,
            deviceKey: selectedDevice.key,
          });
        }
      } else if (input === 'r') {
        load('reloaded');
      } else if (state.notice !== undefined) {
        setState(clearedState);
      }
    } else if (state.type === 'device-match') {
      const proposal = getProposal(state);

      if (key.escape) {
        setState({
          type: 'devices',
          discovery: state.discovery,
          providerBindings: state.providerBindings,
          cursor: getCandidateDeviceIndex(state.discovery, state.deviceKey),
        });
      } else if (key.return && proposal.status !== 'unavailable') {
        prepareSave(state);
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

  return <BindingView state={state} />;
}

type BindingViewProps = {
  readonly state: BindingState;
};

function BindingView({state}: BindingViewProps): React.JSX.Element {
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
    return <DevicesView state={state} />;
  } else if (state.type === 'device-match') {
    return <DeviceMatchView proposal={getProposal(state)} />;
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
}: {
  readonly state: DevicesState;
}): React.JSX.Element {
  const {discovery} = state;
  const visibleDevices = getVisibleItems(
    discovery.devices,
    state.cursor,
    PHYSICAL_DEVICE_PAGE_SIZE,
  );
  const deviceGroups = groupDevicesByLocation(visibleDevices.items);
  const hasSummary =
    discovery.devices.length > PHYSICAL_DEVICE_PAGE_SIZE ||
    discovery.failedDeviceCount > 0 ||
    discovery.incompleteDeviceCount > 0 ||
    state.notice === 'reloaded';

  return (
    <Box flexDirection="column">
      <Text>choose a device</Text>

      <Box flexDirection="column" marginTop={1}>
        {discovery.devices.length === 0 ? (
          <Text dimColor>no matching devices found.</Text>
        ) : (
          deviceGroups.map((group, groupIndex) => (
            <Box
              key={group.location ?? ''}
              flexDirection="column"
              marginTop={groupIndex === 0 ? 0 : 1}
            >
              <Text bold dimColor>
                {group.location ?? 'unknown location'}
              </Text>
              {group.devices.map(device => (
                <ListItem
                  key={device.key}
                  label={getDeviceLabel(device.device)}
                  offline={device.device.online === false}
                  selected={
                    getCandidateDeviceIndex(discovery, device.key) ===
                    state.cursor
                  }
                  status={getDeviceMatchStatus(device, state.providerBindings)}
                />
              ))}
            </Box>
          ))
        )}
      </Box>

      {hasSummary ? (
        <Box flexDirection="column" marginTop={1}>
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

          {state.notice === 'reloaded' ? (
            <Text color="green">devices reloaded.</Text>
          ) : null}
        </Box>
      ) : null}

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
  return (
    <Box flexDirection="column">
      <Box>
        <Text bold>{getDeviceLabel(proposal.device.device)}</Text>
        <DeviceStatusBadges
          offline={proposal.device.device.online === false}
          status={proposal.status}
        />
      </Box>
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

      {proposal.status === 'unavailable' ? (
        <Text color="yellow">
          this device mapping uses resources already bound elsewhere.
        </Text>
      ) : null}

      <Box marginTop={1}>
        {proposal.status === 'automatic' ? (
          <Text bold color="cyan">
            › bind device
          </Text>
        ) : proposal.status === 'existing' ? (
          <Text bold color="cyan">
            › done
          </Text>
        ) : (
          <Text color="yellow">device match unavailable.</Text>
        )}
      </Box>

      <Hint>
        {proposal.status === 'unavailable' ? '' : 'enter confirm · '}esc choose
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
  const color = proposal.status === 'unavailable' ? 'red' : 'green';
  const badge =
    proposal.status === 'automatic'
      ? 'ready'
      : proposal.status === 'existing'
        ? 'bound here'
        : 'used elsewhere';

  return (
    <Box flexDirection="column">
      <Text>
        <Text color={color}>
          {proposal.status === 'unavailable' ? '!' : '●'}{' '}
          {getEndpointLabel(proposal.endpoint.endpoint)}
        </Text>
        <Text bold color={color}>
          {' '}
          [{badge}]
        </Text>
      </Text>
      <Box marginLeft={2}>
        <Text dimColor>{proposal.endpoint.label}</Text>
      </Box>
    </Box>
  );
}

function ListItem({
  label,
  offline,
  selected,
  status,
}: {
  readonly label: string;
  readonly offline: boolean;
  readonly selected: boolean;
  readonly status: MiotBindingDeviceProposal['status'];
}): React.JSX.Element {
  return (
    <Box>
      <Text bold={selected} color={selected ? 'cyan' : undefined}>
        {selected ? '› ' : '  '}
        {label}
      </Text>
      <DeviceStatusBadges offline={offline} status={status} />
    </Box>
  );
}

function DeviceStatusBadges({
  offline,
  status,
}: {
  readonly offline: boolean;
  readonly status: MiotBindingDeviceProposal['status'];
}): React.JSX.Element {
  return (
    <>
      {status === 'existing' ? (
        <Text bold color="green">
          {' '}
          [bound here]
        </Text>
      ) : status === 'unavailable' ? (
        <Text bold color="red">
          {' '}
          [used elsewhere]
        </Text>
      ) : null}
      {offline ? <Text color="yellow"> [offline]</Text> : null}
    </>
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
  | ConfirmSaveState
  | SavingState
  | SaveErrorState;

type DevicesState = {
  readonly type: 'devices';
  readonly discovery: MiotBindingDiscovery;
  readonly providerBindings: readonly MiotBindingResourceBinding[];
  readonly cursor: number;
  readonly notice?: 'reloaded';
};

type DeviceMatchState = {
  readonly type: 'device-match';
  readonly discovery: MiotBindingDiscovery;
  readonly providerBindings: readonly MiotBindingResourceBinding[];
  readonly deviceKey: string;
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

function getProposal(state: DeviceMatchState): MiotBindingDeviceProposal {
  const device = getCandidateDevice(state.discovery, state.deviceKey);

  if (device === undefined) {
    throw new TypeError('Unknown MIoT binding device.');
  }

  return resolveMiotBindingDeviceProposal(device, state.providerBindings);
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
  device: MiotBindingDeviceCandidate,
  endpointPath: EndpointPath,
): MiotBindingEndpointCandidate | undefined {
  const endpointPathKey = getEndpointPathKey(endpointPath);

  return device.endpoints.find(
    endpoint => getEndpointPathKey(endpoint.endpoint.path) === endpointPathKey,
  );
}

function hasProviderBinding(
  endpointPath: EndpointPath,
  bindings: readonly {readonly endpoint: EndpointPath}[],
): boolean {
  const endpointPathKey = getEndpointPathKey(endpointPath);

  return bindings.some(
    binding => getEndpointPathKey(binding.endpoint) === endpointPathKey,
  );
}

function getDeviceLabel(device: BackendDevice): string {
  return device.name ?? device.model ?? device.did;
}

function getDeviceLocation(device: BackendDevice): string | undefined {
  const location = [device.homeName, device.roomName]
    .filter(value => value !== undefined)
    .join(' › ');

  return location === '' ? undefined : location;
}

function getDeviceMatchStatus(
  device: MiotBindingDeviceCandidate,
  providerBindings: readonly MiotBindingResourceBinding[],
): MiotBindingDeviceProposal['status'] {
  return resolveMiotBindingDeviceProposal(device, providerBindings).status;
}

type DeviceGroup = {
  readonly location: string | undefined;
  readonly devices: readonly MiotBindingDeviceCandidate[];
};

function orderDevicesByLocation(
  devices: readonly MiotBindingDeviceCandidate[],
): readonly MiotBindingDeviceCandidate[] {
  return groupDevicesByLocation(devices).flatMap(group => group.devices);
}

function groupDevicesByLocation(
  devices: readonly MiotBindingDeviceCandidate[],
): readonly DeviceGroup[] {
  const groupMap = new Map<string | undefined, MiotBindingDeviceCandidate[]>();

  for (const device of devices) {
    const location = getDeviceLocation(device.device);
    const group = groupMap.get(location);

    if (group === undefined) {
      groupMap.set(location, [device]);
    } else {
      group.push(device);
    }
  }

  return [...groupMap].map(([location, devices]) => ({location, devices}));
}

function getEndpointLabel(
  endpoint: MiotBindingEndpointProposal['endpoint']['endpoint'],
): string {
  return endpoint.endpoint.name === '' ? 'main' : endpoint.endpoint.name;
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
