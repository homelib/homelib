import {readFile} from 'node:fs/promises';

import {x} from '@homelib/x';

import {DeviceId, DeviceName,  ScopePath} from '../x/index.js';

export class ControllerStore {
  private constructor(
    readonly path: string,
    private data: Data,
  ) {}

  static async initialize(path: string): Promise<ControllerStore> {
    const json = await readFile(path, 'utf8');

    const data = Data.decode(x.json, json);

    return new ControllerStore(path, data);
  }

  findDevice(id: DeviceId): DeviceDataItem | undefined {
    return this.data.devices.find(deviceDataItem => deviceDataItem.id === id);
  }
}

const DeviceDataItem = x.object({
  id: DeviceId,
  name: DeviceName,
  path: ScopePath,
});

type DeviceDataItem = x.TypeOf<typeof DeviceDataItem>;

const Data = x.object({
  devices: x.array(DeviceDataItem),
});

type Data = x.TypeOf<typeof Data>;
