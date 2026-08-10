import {Light} from '@homelib/core';

import type {MiotEndpointMatcher, MiotPropertyMatcher} from '../miot/index.js';

const MIOT_LIGHT_ENDPOINT_MATCHER: MiotLightEndpointMatcher = {
  service: 'urn:miot-spec-v2:service:light:00007802',
  properties: {
    on: {
      type: 'urn:miot-spec-v2:property:on:00000006',
      access: ['write'],
    },
  },
};

const MIOT_LIGHT_ENDPOINT_MATCHERS = [MIOT_LIGHT_ENDPOINT_MATCHER];

export class MiotLight extends Light {
  static get endpointMatchers(): readonly MiotLightEndpointMatcher[] {
    return MIOT_LIGHT_ENDPOINT_MATCHERS;
  }
}

type MiotLightEndpointMatcher = MiotEndpointMatcher<{
  readonly on: MiotPropertyMatcher;
}>;
