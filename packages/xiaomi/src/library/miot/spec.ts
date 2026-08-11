import * as x from 'x-value';

const MIOT_SPEC_INSTANCE_URL = 'https://miot-spec.org/miot-spec-v2/instance';
const MIOT_SPEC_REQUEST_TIMEOUT = 30_000;

export class MiotSpecClient {
  private readonly instancePromiseMap = new Map<
    string,
    Promise<MiotSpecInstance>
  >();

  getInstance(urn: string): Promise<MiotSpecInstance> {
    const cachedInstancePromise = this.instancePromiseMap.get(urn);

    if (cachedInstancePromise !== undefined) {
      return cachedInstancePromise;
    }

    const instancePromise = withRequestTimeout(this.requestInstance(urn));

    this.instancePromiseMap.set(urn, instancePromise);
    void instancePromise.catch(() => {
      if (this.instancePromiseMap.get(urn) === instancePromise) {
        this.instancePromiseMap.delete(urn);
      }
    });

    return instancePromise;
  }

  private async requestInstance(urn: string): Promise<MiotSpecInstance> {
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

function withRequestTimeout<T>(request: Promise<T>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      reject(new Error('MIoT spec request timed out.'));
    }, MIOT_SPEC_REQUEST_TIMEOUT);
  });

  // This bounds the cached request's wait; the underlying fetch keeps running.
  return Promise.race([request, timeoutPromise]).finally(() => {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  });
}
