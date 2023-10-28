import type {
  DeviceCard,
  DeviceDeclarationToRemoteDevices,
  types,
} from '../library/index.js';

import type {Scope} from './scope.js';

export type DeviceCardProps<TCard extends DeviceCard> = {
  devices: DeviceDeclarationToRemoteDevices<TCard[types]['devices']>;
  scope: Scope<TCard[types]['scope']>;
};
