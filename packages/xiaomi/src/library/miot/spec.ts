import * as x from 'x-value';

const MIOT_SPEC_INSTANCE_URL = 'https://miot-spec.org/miot-spec-v2/instance';

export class MiotSpecClient {
  async getInstance(urn: string): Promise<MiotSpecInstance> {
    const url = new URL(MIOT_SPEC_INSTANCE_URL);
    url.searchParams.set('type', urn);

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Failed to get MIoT spec instance: ${response.status}.`);
    }

    return MiotSpecInstance.satisfies(await response.json());
  }
}

export const MiotSpecProperty = x.object({
  iid: x.number,
  type: x.string,
  description: x.string,
  format: x.string,
  access: x.array(x.string),
});

export type MiotSpecProperty = x.TypeOf<typeof MiotSpecProperty>;

export const MiotSpecService = x.object({
  iid: x.number,
  type: x.string,
  description: x.string,
  properties: x.array(MiotSpecProperty).optional(),
});

export type MiotSpecService = x.TypeOf<typeof MiotSpecService>;

export const MiotSpecInstance = x.object({
  type: x.string,
  description: x.string,
  services: x.array(MiotSpecService),
});

export type MiotSpecInstance = x.TypeOf<typeof MiotSpecInstance>;
