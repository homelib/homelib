import type {EndpointReference} from '@homelib/core';

import {
  type MiotEndpointAdapter,
  MiotEndpointAdapterRegistry,
} from '../endpoint-adapter.js';

import {miotAirConditionerEndpointAdapter} from './air-conditioner.js';
import {miotDehumidifierEndpointAdapter} from './dehumidifier.js';
import {miotFanEndpointAdapter} from './fan.js';
import {miotLightEndpointAdapter} from './light.js';

export const MIOT_ENDPOINT_ADAPTERS = [
  miotAirConditionerEndpointAdapter,
  miotDehumidifierEndpointAdapter,
  miotFanEndpointAdapter,
  miotLightEndpointAdapter,
] as const satisfies readonly MiotEndpointAdapter[];

const MIOT_ENDPOINT_ADAPTER_REGISTRY = new MiotEndpointAdapterRegistry(
  MIOT_ENDPOINT_ADAPTERS,
);

export function getMiotEndpointAdapter(
  endpoint: EndpointReference,
): MiotEndpointAdapter | undefined {
  return MIOT_ENDPOINT_ADAPTER_REGISTRY.get(endpoint);
}

export * from './air-conditioner.js';
export * from './command-effect.js';
export * from './dehumidifier.js';
export * from './fan.js';
export * from './light.js';
export * from './placeholder.js';
export * from './value-range.js';
