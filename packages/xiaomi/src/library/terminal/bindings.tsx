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
  type MiotBindingResourceBinding,
  discoverMiotBindingDevices,
  prepareMiotBindingResourceBindings,
  resolveMiotBindingDeviceProposal,
} from '../binding.js';
import type {MiotProvider} from '../provider.js';

import {useMiotTerminalI18n} from './@i18n.js';

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
  const messages = useMiotTerminalI18n();

  if (state.type === 'loading') {
    return (
      <Box flexDirection="column">
        <Text>{messages.bindings.loading}</Text>
        <Hint>{messages.bindings.backHint}</Hint>
      </Box>
    );
  } else if (state.type === 'load-error') {
    return (
      <ErrorView message={state.message}>
        {messages.bindings.loadErrorHint}
      </ErrorView>
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
        <Text>{messages.bindings.confirmReplacement(replacementCount)}</Text>
        <Hint>{messages.bindings.confirmHint}</Hint>
      </Box>
    );
  } else if (state.type === 'saving') {
    return (
      <Box flexDirection="column">
        <Text>{messages.bindings.saving}</Text>
      </Box>
    );
  }

  return (
    <ErrorView message={state.message}>
      {messages.bindings.loadErrorHint}
    </ErrorView>
  );
}

function DevicesView({
  state,
}: {
  readonly state: DevicesState;
}): React.JSX.Element {
  const messages = useMiotTerminalI18n();
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
      <Text>{messages.bindings.chooseDevice}</Text>

      <Box flexDirection="column" marginTop={1}>
        {discovery.devices.length === 0 ? (
          <Text dimColor>{messages.bindings.noDevices}</Text>
        ) : (
          deviceGroups.map((group, groupIndex) => (
            <Box
              key={group.location ?? ''}
              flexDirection="column"
              marginTop={groupIndex === 0 ? 0 : 1}
            >
              <Text bold dimColor>
                {group.location ?? messages.bindings.unknownLocation}
              </Text>
              <Box flexDirection="column" marginTop={1}>
                {group.devices.map(device => (
                  <ListItem
                    key={device.key}
                    label={getDeviceLabel(device.device)}
                    offline={device.device.online === false}
                    selected={
                      getCandidateDeviceIndex(discovery, device.key) ===
                      state.cursor
                    }
                    status={getDeviceMatchStatus(
                      device,
                      state.providerBindings,
                    )}
                  />
                ))}
              </Box>
            </Box>
          ))
        )}
      </Box>

      {hasSummary ? (
        <Box flexDirection="column" marginTop={1}>
          {discovery.devices.length <= PHYSICAL_DEVICE_PAGE_SIZE ? null : (
            <Text dimColor>
              {messages.bindings.range(
                visibleDevices.startIndex + 1,
                visibleDevices.startIndex + visibleDevices.items.length,
                discovery.devices.length,
              )}
            </Text>
          )}

          {discovery.failedDeviceCount === 0 ? null : (
            <Text color="yellow">
              {messages.bindings.failedDevices(discovery.failedDeviceCount)}
            </Text>
          )}

          {discovery.incompleteDeviceCount === 0 ? null : (
            <Text dimColor>
              {messages.bindings.incompleteDevices(
                discovery.incompleteDeviceCount,
              )}
            </Text>
          )}

          {state.notice === 'reloaded' ? (
            <Text color="green">{messages.bindings.reloaded}</Text>
          ) : null}
        </Box>
      ) : null}

      <Hint>{messages.bindings.listHint(discovery.devices.length > 0)}</Hint>
    </Box>
  );
}

function DeviceMatchView({
  proposal,
}: {
  readonly proposal: MiotBindingDeviceProposal;
}): React.JSX.Element {
  const messages = useMiotTerminalI18n();

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

      {proposal.status === 'unavailable' ? (
        <Text color="yellow">{messages.bindings.mappingUnavailable}</Text>
      ) : null}

      <Box marginTop={1}>
        {proposal.status === 'automatic' ? (
          <Text bold color="cyan">
            {messages.bindings.bind}
          </Text>
        ) : proposal.status === 'existing' ? (
          <Text bold color="cyan">
            {messages.bindings.done}
          </Text>
        ) : (
          <Text color="yellow">{messages.bindings.unavailable}</Text>
        )}
      </Box>

      <Hint>
        {messages.bindings.matchHint(proposal.status !== 'unavailable')}
      </Hint>
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
  const messages = useMiotTerminalI18n();

  return (
    <>
      {status === 'existing' ? (
        <Text bold color="green">
          {' '}
          [{messages.bindings.boundHere}]
        </Text>
      ) : status === 'unavailable' ? (
        <Text bold color="red">
          {' '}
          [{messages.bindings.usedElsewhere}]
        </Text>
      ) : null}
      {offline ? (
        <Text color="yellow"> [{messages.bindings.offline}]</Text>
      ) : null}
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
  const messages = useMiotTerminalI18n();

  return (
    <Box flexDirection="column">
      <Text color="red">{messages.common.error(message)}</Text>
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
