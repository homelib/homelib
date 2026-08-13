import * as x from 'x-value';

import type {MiotProperty, MiotSetPropertyRequest} from '../miot/index.js';

import {
  BACKEND_API_TIMEOUT,
  type CloudServer,
  DEFAULT_CLOUD_SERVER,
  OAUTH2_CLIENT_ID,
  getBackendApiHost,
} from './constants.js';

const HOME_PAGE_SIZE = 150;
const DEVICE_REQUEST_SIZE = 150;
const DEVICE_PAGE_SIZE = 200;

const BackendApiResponse = x.object({
  code: x.number,
  message: x.string.optional(),
  result: x.unknown.optional(),
});

const BackendPropertyResultValue = x.object({
  did: x.string,
  siid: x.number,
  piid: x.number,
  value: x.unknown.optional(),
  code: x.number,
});

export class BackendClient {
  readonly uuid: string;

  readonly cloudServer: CloudServer;

  private token: string;

  private readonly apiUrl: string;

  constructor(options: BackendClientOptions) {
    this.uuid = options.uuid;
    this.cloudServer = options.cloudServer ?? DEFAULT_CLOUD_SERVER;
    this.token = options.accessToken;
    this.apiUrl = `https://${getBackendApiHost(this.cloudServer)}`;
  }

  get accessToken(): string {
    return this.token;
  }

  updateAccessToken(accessToken: string): void {
    this.token = accessToken;
  }

  async discoverDevices(): Promise<BackendDeviceDiscovery> {
    const {userId, homes, locations} = await this.getHomes();
    const homeDeviceMap = await this.getDevicesWithDids([...locations.keys()]);
    const allDeviceMap = await this.getDeviceListPage([]);

    for (const [did, device] of allDeviceMap) {
      if (locations.has(did)) {
        continue;
      }

      if (device.ownerId === undefined || device.ownerName === undefined) {
        continue;
      }

      const home = getOrCreateSharedDeviceHome(
        homes,
        device.ownerId,
        device.ownerName,
      );
      locations.set(did, {
        source: 'shared-device',
        homeId: home.id,
        homeName: home.name,
        roomId: 'shared-device',
        roomName: 'shared-device',
      });
      homeDeviceMap.set(did, device);
    }

    const devices = [...homeDeviceMap.values()].map(device => ({
      did: device.did,
      name: device.name,
      model: device.model,
      specType: device.specType,
      online: device.online,
      parentDid: device.parentDid,
      firmwareVersion: device.firmwareVersion,
      ...locations.get(device.did),
    }));

    devices.sort(compareDevices);

    return {
      userId,
      homes: [...homes.values()]
        .map(home => ({
          id: home.id,
          name: home.name,
          source: home.source,
          userId: home.userId,
          rooms: [...home.rooms.values()].sort(compareNames),
        }))
        .sort(compareNames),
      devices,
    };
  }

  async getDeviceOnline(did: string): Promise<boolean> {
    const device = (await this.getDeviceListPage([did])).get(did);

    if (device === undefined) {
      throw new Error(`Cloud device was not returned: ${did}.`);
    } else if (device.online === undefined) {
      throw new Error(`Cloud device ${did} returned invalid online state.`);
    }

    return device.online;
  }

  async getProperties(
    properties: readonly MiotProperty[],
  ): Promise<readonly BackendPropertyResult[]> {
    const result = await this.post('/app/v2/miotspec/prop/get', {
      datasource: 1,
      params: properties,
    });

    return x.array(BackendPropertyResultValue).satisfies(result);
  }

  async setProperties(
    requests: readonly MiotSetPropertyRequest[],
  ): Promise<readonly BackendPropertyResult[]> {
    const result = await this.post('/app/v2/miotspec/prop/set', {
      params: requests.map(request => ({
        ...request.property,
        value: request.value,
      })),
    });

    return x.array(BackendPropertyResultValue).satisfies(result);
  }

  async getCentralCertificate(certificateRequest: string): Promise<string> {
    const result = requireRecord(
      await this.post('/app/v2/ha/oauth/get_central_crt', {
        csr: Buffer.from(certificateRequest).toString('base64'),
      }),
      'central certificate result',
    );
    const certificate = readString(result.cert);

    if (certificate === undefined) {
      throw new Error('Cloud API returned an invalid central certificate.');
    }

    return certificate;
  }

  private async getHomes(): Promise<HomeDiscovery> {
    const result = requireRecord(
      await this.post('/app/v2/homeroom/gethome', {
        limit: HOME_PAGE_SIZE,
        fetch_share: true,
        fetch_share_dev: true,
        plat_form: 0,
        app_ver: 9,
      }),
      'home list result',
    );
    const homes = new Map<string, MutableHome>();
    const locations = new Map<string, DeviceLocation>();
    let userId: string | undefined;

    for (const [key, source] of [
      ['homelist', 'owned'],
      ['share_home_list', 'shared-home'],
    ] as const) {
      for (const value of readArray(result[key])) {
        const home = readHome(value, source);

        if (home === undefined) {
          continue;
        }

        homes.set(getHomeKey(home.source, home.id), home);
        indexHome(home, locations);

        if (source === 'owned' && userId === undefined) {
          userId = home.userId;
        }
      }
    }

    const hasMore = result.has_more === true;
    const maxId = readString(result.max_id);

    if (hasMore && maxId !== undefined) {
      await this.extendHomes(homes, locations, maxId);
    }

    return {userId, homes, locations};
  }

  private async extendHomes(
    homes: Map<string, MutableHome>,
    locations: Map<string, DeviceLocation>,
    initialMaxId: string,
  ): Promise<void> {
    let maxId: string | undefined = initialMaxId;

    while (maxId !== undefined) {
      const currentMaxId: string = maxId;
      const result = requireRecord(
        await this.post('/app/v2/homeroom/get_dev_room_page', {
          start_id: currentMaxId,
          limit: HOME_PAGE_SIZE,
        }),
        'home room page result',
      );

      for (const value of readArray(result.info)) {
        const pageHome = requireRecord(value, 'home room page item');
        const homeId = readIdentifier(pageHome.id);
        const home =
          homeId === undefined ? undefined : getHomeById(homes, homeId);

        if (home === undefined) {
          continue;
        }

        mergeHomePage(home, pageHome);
        indexHome(home, locations);
      }

      const nextMaxId = readString(result.max_id);

      if (result.has_more !== true) {
        maxId = undefined;
      } else if (nextMaxId === undefined || nextMaxId === currentMaxId) {
        throw new Error('Cloud home pagination returned an invalid cursor.');
      } else {
        maxId = nextMaxId;
      }
    }
  }

  private async getDevicesWithDids(
    dids: string[],
  ): Promise<Map<string, DeviceDetail>> {
    const results = await Promise.all(
      chunk(dids, DEVICE_REQUEST_SIZE).map(batch =>
        this.getDeviceListPage(batch),
      ),
    );
    const devices = new Map<string, DeviceDetail>();

    for (const result of results) {
      for (const [did, device] of result) {
        devices.set(did, device);
      }
    }

    return devices;
  }

  private async getDeviceListPage(
    dids: string[],
  ): Promise<Map<string, DeviceDetail>> {
    const devices = new Map<string, DeviceDetail>();
    let startDid: string | undefined;

    while (true) {
      const data: Record<string, unknown> = {
        limit: DEVICE_PAGE_SIZE,
        get_split_device: true,
        get_third_device: true,
        dids,
      };

      if (startDid !== undefined) {
        data.start_did = startDid;
      }

      const result = requireRecord(
        await this.post('/app/v2/home/device_list_page', data),
        'device list result',
      );

      for (const value of readArray(result.list)) {
        const device = readDevice(value);

        if (device !== undefined) {
          devices.set(device.did, device);
        }
      }

      const nextStartDid = readString(result.next_start_did);

      if (result.has_more !== true) {
        break;
      } else if (nextStartDid === undefined || nextStartDid === startDid) {
        throw new Error('Cloud device pagination returned an invalid cursor.');
      } else {
        startDid = nextStartDid;
      }
    }

    return devices;
  }

  private post(path: string, data: Record<string, unknown>): Promise<unknown> {
    return withRequestTimeout(
      this.sendPost(path, data),
      `Cloud API request timed out (${path}).`,
    );
  }

  private async sendPost(
    path: string,
    data: Record<string, unknown>,
  ): Promise<unknown> {
    const response = await fetch(`${this.apiUrl}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-client-bizid': 'haapi',
        'x-client-appid': OAUTH2_CLIENT_ID,
        // Xiaomi's HA API expects no space after "Bearer".
        authorization: `Bearer${this.token}`,
      },
      body: JSON.stringify(data),
    });

    if (response.status === 401) {
      throw new Error('Cloud API access token was rejected.');
    } else if (!response.ok) {
      throw new Error(
        `Cloud API request failed: ${response.status} (${path}).`,
      );
    }

    const {code, message, result} = BackendApiResponse.satisfies(
      await response.json(),
    );

    if (code !== 0) {
      throw new Error(
        `Cloud API request failed: ${code}${message === undefined ? '' : ` (${message})`} (${path}).`,
      );
    } else if (result === undefined) {
      throw new Error(`Cloud API response is missing a result (${path}).`);
    }

    return result;
  }
}

export type BackendDeviceDiscovery = {
  readonly userId?: string;
  readonly homes: readonly BackendHome[];
  readonly devices: readonly BackendDevice[];
};

export type BackendClientOptions = {
  readonly uuid: string;
  readonly accessToken: string;
  readonly cloudServer?: CloudServer;
};

export type BackendPropertyResult = x.TypeOf<typeof BackendPropertyResultValue>;

export type BackendHomeSource = 'owned' | 'shared-home' | 'shared-device';

export type BackendHome = {
  readonly id: string;
  readonly name: string;
  readonly source: BackendHomeSource;
  readonly userId?: string;
  readonly rooms: readonly BackendRoom[];
};

export type BackendRoom = {
  readonly id: string;
  readonly name: string;
};

export type BackendDevice = {
  readonly did: string;
  readonly name?: string;
  readonly model?: string;
  readonly specType?: string;
  readonly online?: boolean;
  readonly parentDid?: string;
  readonly firmwareVersion?: string;
  readonly source?: BackendHomeSource;
  readonly homeId?: string;
  readonly homeName?: string;
  readonly roomId?: string;
  readonly roomName?: string;
};

type HomeDiscovery = {
  readonly userId?: string;
  readonly homes: Map<string, MutableHome>;
  readonly locations: Map<string, DeviceLocation>;
};

type MutableHome = {
  readonly id: string;
  readonly name: string;
  readonly source: BackendHomeSource;
  readonly userId?: string;
  readonly deviceIds: Set<string>;
  readonly rooms: Map<string, MutableRoom>;
};

type MutableRoom = {
  readonly id: string;
  readonly name: string;
  readonly deviceIds: Set<string>;
};

type DeviceLocation = {
  readonly source: BackendHomeSource;
  readonly homeId: string;
  readonly homeName: string;
  readonly roomId: string;
  readonly roomName: string;
};

type DeviceDetail = {
  readonly did: string;
  readonly name?: string;
  readonly model?: string;
  readonly specType?: string;
  readonly online?: boolean;
  readonly parentDid?: string;
  readonly firmwareVersion?: string;
  readonly ownerId?: string;
  readonly ownerName?: string;
};

function readHome(
  value: unknown,
  source: BackendHomeSource,
): MutableHome | undefined {
  const record = readRecord(value);
  const id = readIdentifier(record?.id);
  const name = readString(record?.name);

  if (record === undefined || id === undefined || name === undefined) {
    return undefined;
  }

  const home: MutableHome = {
    id,
    name,
    source,
    userId: readIdentifier(record.uid),
    deviceIds: new Set(readIdentifiers(record.dids)),
    rooms: new Map(),
  };

  for (const roomValue of readArray(record.roomlist)) {
    const roomRecord = readRecord(roomValue);
    const roomId = readIdentifier(roomRecord?.id);
    const roomName = readString(roomRecord?.name);

    if (roomRecord !== undefined && roomId !== undefined) {
      home.rooms.set(roomId, {
        id: roomId,
        name: roomName ?? '',
        deviceIds: new Set(readIdentifiers(roomRecord.dids)),
      });
    }
  }

  return home;
}

function mergeHomePage(home: MutableHome, page: Record<string, unknown>): void {
  for (const did of readIdentifiers(page.dids)) {
    home.deviceIds.add(did);
  }

  for (const roomValue of readArray(page.roomlist)) {
    const roomRecord = readRecord(roomValue);
    const roomId = readIdentifier(roomRecord?.id);

    if (roomRecord === undefined || roomId === undefined) {
      continue;
    }

    let room = home.rooms.get(roomId);

    if (room === undefined) {
      room = {
        id: roomId,
        name: readString(roomRecord.name) ?? '',
        deviceIds: new Set(),
      };
      home.rooms.set(roomId, room);
    }

    for (const did of readIdentifiers(roomRecord.dids)) {
      room.deviceIds.add(did);
    }
  }
}

function indexHome(
  home: MutableHome,
  locations: Map<string, DeviceLocation>,
): void {
  for (const did of home.deviceIds) {
    locations.set(did, {
      source: home.source,
      homeId: home.id,
      homeName: home.name,
      roomId: home.id,
      roomName: home.name,
    });
  }

  for (const room of home.rooms.values()) {
    for (const did of room.deviceIds) {
      locations.set(did, {
        source: home.source,
        homeId: home.id,
        homeName: home.name,
        roomId: room.id,
        roomName: room.name,
      });
    }
  }
}

function readDevice(value: unknown): DeviceDetail | undefined {
  const record = readRecord(value);
  const did = readString(record?.did);

  if (record === undefined || did === undefined) {
    return undefined;
  }

  const extra = readRecord(record.extra);
  const owner = readRecord(record.owner);

  return {
    did,
    name: readString(record.name),
    model: readString(record.model),
    specType: readString(record.spec_type),
    online: readBoolean(record.isOnline),
    parentDid: readString(record.parent_id),
    firmwareVersion: readString(extra?.fw_version),
    ownerId: readIdentifier(owner?.userid),
    ownerName: readString(owner?.nickname),
  };
}

function getOrCreateSharedDeviceHome(
  homes: Map<string, MutableHome>,
  ownerId: string,
  ownerName: string,
): MutableHome {
  const key = getHomeKey('shared-device', ownerId);
  const existing = homes.get(key);

  if (existing !== undefined) {
    return existing;
  }

  const home: MutableHome = {
    id: ownerId,
    name: ownerName,
    source: 'shared-device',
    userId: ownerId,
    deviceIds: new Set(),
    rooms: new Map([
      [
        'shared-device',
        {id: 'shared-device', name: 'shared-device', deviceIds: new Set()},
      ],
    ]),
  };
  homes.set(key, home);
  return home;
}

function getHomeKey(source: BackendHomeSource, id: string): string {
  return JSON.stringify([source, id]);
}

function getHomeById(
  homes: ReadonlyMap<string, MutableHome>,
  id: string,
): MutableHome | undefined {
  let matchingHome: MutableHome | undefined;

  for (const home of homes.values()) {
    if (home.id !== id) {
      continue;
    } else if (matchingHome !== undefined) {
      throw new Error(
        `Cloud home pagination returned ambiguous home id: ${id}.`,
      );
    }

    matchingHome = home;
  }

  return matchingHome;
}

function requireRecord(
  value: unknown,
  description: string,
): Record<string, unknown> {
  const record = readRecord(value);

  if (record === undefined) {
    throw new Error(`Cloud API returned an invalid ${description}.`);
  }

  return record;
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
}

function readArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function readIdentifier(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  } else if (typeof value === 'number' && Number.isSafeInteger(value)) {
    return String(value);
  }

  return undefined;
}

function readIdentifiers(value: unknown): string[] {
  return readArray(value)
    .map(readIdentifier)
    .filter((item): item is string => item !== undefined);
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function chunk<T>(values: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];

  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }

  return chunks;
}

function compareDevices(left: BackendDevice, right: BackendDevice): number {
  return (
    (left.homeName ?? '').localeCompare(right.homeName ?? '') ||
    (left.roomName ?? '').localeCompare(right.roomName ?? '') ||
    (left.name ?? '').localeCompare(right.name ?? '') ||
    left.did.localeCompare(right.did)
  );
}

function compareNames(
  left: {readonly name: string},
  right: {readonly name: string},
): number {
  return left.name.localeCompare(right.name);
}

function withRequestTimeout<T>(
  request: Promise<T>,
  message: string,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(message));
    }, BACKEND_API_TIMEOUT);
  });

  // This only bounds the caller's wait; the underlying fetch keeps running.
  return Promise.race([request, timeoutPromise]).finally(() => {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  });
}
