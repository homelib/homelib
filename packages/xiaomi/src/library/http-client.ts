/**
 * Xiaomi MIoT HTTP API client.
 *
 * Wraps the cloud REST API for:
 * - Getting user info (nickname)
 * - Getting home/room/device lists
 * - Getting and setting device properties (MIoT-Spec-V2)
 * - Calling device actions
 * - Obtaining central hub gateway certificates (CN only)
 */

import {createHash} from 'node:crypto';
import {Agent, type RequestOptions, request as httpsRequest} from 'node:https';

import {
  type CloudServer,
  MIHOME_HTTP_API_TIMEOUT,
  getApiHost,
} from './constants.js';

/** Device info as returned by the cloud device list API. */
export type DeviceInfo = {
  did: string;
  uid?: string;
  name: string;
  urn: string;
  model: string;
  connect_type: number;
  token?: string;
  online: boolean;
  icon?: string;
  parent_id?: string;
  manufacturer: string;
  voice_ctrl?: number;
  rssi?: number;
  owner?: unknown;
  pid?: number;
  local_ip?: string;
  ssid?: string;
  bssid?: string;
  order_time?: number;
  fw_version?: string;
  home_id: string;
  home_name: string;
  room_id: string;
  room_name: string;
  group_id: string;
  sub_devices?: Record<string, DeviceInfo>;
};

export type HomeInfo = {
  home_id: string;
  home_name: string;
  city_id?: number;
  longitude?: number;
  latitude?: number;
  address?: string;
  dids: string[];
  room_info: Record<
    string,
    {room_id: string; room_name: string; dids: string[]}
  >;
  group_id: string;
  uid: string;
};

export type HomeInfosResult = {
  uid: string;
  home_list: Record<string, HomeInfo>;
  share_home_list: Record<string, HomeInfo>;
};

export type DevicesResult = {
  uid: string;
  homes: Record<string, Record<string, unknown>>;
  devices: Record<string, DeviceInfo>;
};

export type HttpClientOptions = {
  cloudServer: CloudServer;
  clientId: string;
  accessToken: string;
};

export class XiaomiHttpClient {
  private host: string;
  private baseUrl: string;
  private clientId: string;
  private accessToken: string;
  /** Reuse TLS sessions across requests. */
  private readonly agent = new Agent({keepAlive: true});

  constructor(options: HttpClientOptions) {
    this.host = getApiHost(options.cloudServer);
    this.baseUrl = `https://${this.host}`;
    this.clientId = options.clientId;
    this.accessToken = options.accessToken;
  }

  /** Update the access token (e.g. after a refresh). */
  updateAccessToken(accessToken: string): void {
    this.accessToken = accessToken;
  }

  /** Get the current Xiaomi user's profile / nickname. */
  async getUserInfo(): Promise<{miliaoNick: string; [key: string]: unknown}> {
    const params = new URLSearchParams({
      clientId: this.clientId,
      token: this.accessToken,
    });
    const url = `https://open.account.xiaomi.com/user/profile?${params.toString()}`;

    const res = await this.get(url, {
      'content-type': 'application/x-www-form-urlencoded',
    });

    const body = JSON.parse(res.body);
    if (!body || body.code !== 0 || !body.data || !body.data.miliaoNick) {
      throw new Error(`Invalid user info response: ${res.body}`);
    }
    return body.data;
  }

  /** Get all homes (including shared homes) and their room/device layout. */
  async getHomeInfos(): Promise<HomeInfosResult> {
    const res = await this.mihomeApiPost('/app/v2/homeroom/gethome', {
      limit: 150,
      fetch_share: true,
      fetch_share_dev: true,
      plat_form: 0,
      app_ver: 9,
    });

    const result = res.result;
    let uid: string | undefined;
    const homeInfos: Record<string, Record<string, HomeInfo>> = {};

    for (const source of ['homelist', 'share_home_list'] as const) {
      homeInfos[source] = {};
      for (const home of result[source] ?? []) {
        if (!home.id || !home.name || !home.roomlist) continue;
        if (uid === undefined && source === 'homelist') {
          uid = String(home.uid);
        }
        homeInfos[source][home.id] = {
          home_id: home.id,
          home_name: home.name,
          city_id: home.city_id,
          longitude: home.longitude,
          latitude: home.latitude,
          address: home.address,
          dids: home.dids ?? [],
          room_info: {},
          group_id: calcGroupId(home.uid, home.id),
          uid: String(home.uid),
        };
        for (const room of home.roomlist) {
          if (!room.id) continue;
          homeInfos[source][home.id].room_info[room.id] = {
            room_id: room.id,
            room_name: room.name,
            dids: room.dids ?? [],
          };
        }
      }
    }

    return {
      uid: uid ?? '',
      home_list: homeInfos.homelist ?? {},
      share_home_list: homeInfos.share_home_list ?? {},
    };
  }

  /** Get all devices across all homes. */
  async getDevices(): Promise<DevicesResult> {
    const homeInfos = await this.getHomeInfos();

    const homes: Record<
      string,
      Record<
        string,
        {
          home_name: string;
          uid: string;
          group_id: string;
          room_info: Record<string, string>;
        }
      >
    > = {};
    const devices: Record<string, Partial<DeviceInfo>> = {};

    for (const source of ['home_list', 'share_home_list'] as const) {
      homes[source] = {};
      for (const [homeId, homeInfo] of Object.entries(
        homeInfos[source] ?? {},
      )) {
        homes[source][homeId] = {
          home_name: homeInfo.home_name,
          uid: homeInfo.uid,
          group_id: homeInfo.group_id,
          room_info: {},
        };
        for (const did of homeInfo.dids) {
          devices[did] = {
            home_id: homeId,
            home_name: homeInfo.home_name,
            room_id: homeId,
            room_name: homeInfo.home_name,
            group_id: homeInfo.group_id,
          };
        }
        for (const [roomId, roomInfo] of Object.entries(homeInfo.room_info)) {
          homes[source][homeId].room_info[roomId] = roomInfo.room_name;
          for (const did of roomInfo.dids) {
            devices[did] = {
              home_id: homeId,
              home_name: homeInfo.home_name,
              room_id: roomId,
              room_name: roomInfo.room_name,
              group_id: homeInfo.group_id,
            };
          }
        }
      }
    }

    const dids = Object.keys(devices).sort();
    const deviceDetails = await this.getDevicesWithDids(dids);

    for (const did of dids) {
      const detail = deviceDetails[did];
      if (!detail) {
        delete devices[did];
        continue;
      }
      // Merge detail into existing device info, but preserve home/room fields
      // that were set from the home list (detail has empty home_id etc.)
      const existing = devices[did]!;
      devices[did] = {
        ...detail,
        home_id: existing.home_id,
        home_name: existing.home_name,
        room_id: existing.room_id,
        room_name: existing.room_name,
        group_id: existing.group_id,
      };
    }

    return {
      uid: homeInfos.uid,
      homes,
      devices: devices as Record<string, DeviceInfo>,
    };
  }

  /** Get device details for a list of DIDs (batched at 150 per request). */
  async getDevicesWithDids(
    dids: string[],
  ): Promise<Record<string, DeviceInfo>> {
    const results = await Promise.all(
      chunk(dids, 150).map(batch => this.getDeviceListPage(batch)),
    );
    const merged: Record<string, DeviceInfo> = {};
    for (const result of results) {
      Object.assign(merged, result);
    }
    return merged;
  }

  private async getDeviceListPage(
    dids: string[],
    startDid?: string,
  ): Promise<Record<string, DeviceInfo>> {
    const reqData: Record<string, unknown> = {
      limit: 200,
      get_split_device: true,
      get_third_device: true,
      dids,
    };
    if (startDid) {
      reqData.start_did = startDid;
    }

    const res = await this.mihomeApiPost(
      '/app/v2/home/device_list_page',
      reqData,
    );
    const list = res.result?.list ?? [];
    const devices: Record<string, DeviceInfo> = {};

    for (const device of list) {
      const did = device.did;
      const name = device.name;
      const urn = device.spec_type;
      const model = device.model;
      if (!did || !name || !urn || !model) continue;
      if (did.startsWith('miwifi.')) continue;

      devices[did] = {
        did,
        uid: device.uid,
        name,
        urn,
        model,
        connect_type: device.pid ?? -1,
        token: device.token,
        online: device.isOnline ?? false,
        icon: device.icon,
        parent_id: device.parent_id,
        manufacturer: model.split('.')[0],
        voice_ctrl: device.voice_ctrl ?? 0,
        rssi: device.rssi,
        owner: device.owner,
        pid: device.pid,
        local_ip: device.local_ip,
        ssid: device.ssid,
        bssid: device.bssid,
        order_time: device.orderTime ?? 0,
        fw_version: device.extra?.fw_version,
        home_id: '',
        home_name: '',
        room_id: '',
        room_name: '',
        group_id: '',
      };
    }

    if (res.result?.has_more && res.result.next_start_did) {
      const more = await this.getDeviceListPage(
        dids,
        res.result.next_start_did,
      );
      Object.assign(devices, more);
    }

    return devices;
  }

  /**
   * Get device properties.
   * @param params Array of `{did, siid, piid}`.
   */
  async getProps(
    params: Array<{did: string; siid: number; piid: number}>,
  ): Promise<Array<{did: string; siid: number; piid: number; value: unknown}>> {
    const res = await this.mihomeApiPost('/app/v2/miotspec/prop/get', {
      datasource: 1,
      params,
    });
    return res.result;
  }

  /** Convenience: get a single property value. */
  async getProp(did: string, siid: number, piid: number): Promise<unknown> {
    const results = await this.getProps([{did, siid, piid}]);
    return results[0]?.value ?? null;
  }

  /**
   * Set device properties.
   * @param params Array of `{did, siid, piid, value}`.
   */
  async setProps(
    params: Array<{did: string; siid: number; piid: number; value: unknown}>,
  ): Promise<unknown[]> {
    const res = await this.mihomeApiPost(
      '/app/v2/miotspec/prop/set',
      {params},
      15_000,
    );
    return res.result;
  }

  /** Convenience: set a single property. */
  async setProp(
    did: string,
    siid: number,
    piid: number,
    value: unknown,
  ): Promise<unknown[]> {
    return this.setProps([{did, siid, piid, value}]);
  }

  /** Call a device action. */
  async action(
    did: string,
    siid: number,
    aiid: number,
    inList: unknown[],
  ): Promise<unknown> {
    const res = await this.mihomeApiPost(
      '/app/v2/miotspec/action',
      {
        params: {
          did,
          siid,
          aiid,
          in: inList,
        },
      },
      15_000,
    );
    return res.result;
  }

  /** Get the central hub gateway certificate (CN only). */
  async getCentralCert(csr: string): Promise<string> {
    const res = await this.mihomeApiPost('/app/v2/ha/oauth/get_central_crt', {
      csr: Buffer.from(csr).toString('base64'),
    });
    return res.result?.cert;
  }

  // ---- Internal helpers ----

  private get apiHeaders(): Record<string, string> {
    return {
      Host: this.host,
      'X-Client-BizId': 'haapi',
      'Content-Type': 'application/json',
      Authorization: `Bearer${this.accessToken}`,
      'X-Client-AppId': this.clientId,
    };
  }

  private async mihomeApiPost(
    urlPath: string,
    data: Record<string, unknown>,
    timeout: number = MIHOME_HTTP_API_TIMEOUT,
  ): Promise<{code: number; result: any; message?: string}> {
    const url = `${this.baseUrl}${urlPath}`;
    const body = JSON.stringify(data);
    const res = await httpsPost(
      url,
      body,
      this.apiHeaders,
      timeout,
      this.agent,
    );

    if (res.status === 401) {
      throw new Error(`MIoT API unauthorized (401): ${urlPath}`);
    }
    if (res.status !== 200) {
      throw new Error(`MIoT API POST failed, HTTP ${res.status}: ${urlPath}`);
    }

    const parsed = JSON.parse(res.body);
    if (parsed.code !== 0) {
      throw new Error(
        `MIoT API error, code ${parsed.code}: ${parsed.message ?? ''}`,
      );
    }
    return parsed;
  }

  private async get(
    url: string,
    headers: Record<string, string>,
  ): Promise<{status: number; body: string}> {
    return httpsGetWithAgent(url, headers, MIHOME_HTTP_API_TIMEOUT, this.agent);
  }
}

// ---- Utility functions ----

/** Calculate the group ID from uid + home_id (SHA1, first 16 hex chars). */
export function calcGroupId(
  uid: string | number,
  homeId: string | number,
): string {
  return createHash('sha1')
    .update(`${uid}central_service${homeId}`)
    .digest('hex')
    .slice(0, 16);
}

function chunk<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}

/** HTTPS POST helper. */
function httpsPost(
  url: string,
  body: string,
  headers: Record<string, string>,
  timeout: number,
  agent: Agent,
): Promise<{status: number; body: string}> {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      url,
      {
        method: 'POST',
        headers: {...headers, 'Content-Length': Buffer.byteLength(body)},
        timeout,
        agent,
      },
      res => {
        let data = '';
        res.on('data', (chunk: Buffer) => (data += chunk.toString()));
        res.on('end', () => resolve({status: res.statusCode ?? 0, body: data}));
      },
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('Request timed out')));
    req.write(body);
    req.end();
  });
}

/** HTTPS GET helper with a custom agent. */
function httpsGetWithAgent(
  url: string,
  headers: Record<string, string>,
  timeout: number,
  agent: Agent,
): Promise<{status: number; body: string}> {
  return new Promise((resolve, reject) => {
    const options: RequestOptions = {
      method: 'GET',
      headers,
      timeout,
      agent,
    };
    const req = httpsRequest(url, options, res => {
      let data = '';
      res.on('data', (chunk: Buffer) => (data += chunk.toString()));
      res.on('end', () => resolve({status: res.statusCode ?? 0, body: data}));
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('Request timed out')));
    req.end();
  });
}
