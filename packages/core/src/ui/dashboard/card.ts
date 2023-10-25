import type {
  Card,
  DeviceDeclarationToRemoteDevices,
  ScopeToRemoteScope,
  types,
} from '../../library/index.js';

export type DeviceCardProps<TCard extends Card> = {
  devices: DeviceDeclarationToRemoteDevices<TCard[types]['devices']>;
  scope: ScopeToRemoteScope<TCard[types]['scope']>;
};
