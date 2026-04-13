import {readFile} from 'node:fs/promises';

import {x} from '@homelib/x';

import {DeviceId, DeviceName, ScopePath} from '../x/index.js';

export class ControllerStore {
  constructor(
    readonly path: string,
    private data: ControllerStore.Data,
  ) {}

  static async initialize(path: string): Promise<ControllerStore> {
    const data = await readFile(path, 'utf8').then(
      json => ControllerStore.Data.decode(x.json, json),
      () => {
        return {
          devices: [],
        };
      },
    );

    return new ControllerStore(path, data);
  }

  findDevice(id: DeviceId): ControllerStore.DeviceDataItem | undefined {
    return this.data.devices.find(deviceDataItem => deviceDataItem.id === id);
  }
}

export namespace ControllerStore {
  export const DeviceDataItem = x.object({
    id: DeviceId,
    name: DeviceName,
    path: ScopePath,
  });

  export type DeviceDataItem = x.TypeOf<typeof DeviceDataItem>;

  export const Data = x.object({
    devices: x.array(DeviceDataItem),
  });

  export type Data = x.TypeOf<typeof Data>;
}
