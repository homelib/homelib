**home.js**

```ts
import {Environment, Home, Room, Area, Dashboard} from '@homelib/core';
import {NaturalLight} from '@homelib/lighting';
import {XiaomiDeviceManager} from '@homelib/xiaomi';

import {AmbientLightAutomation} from './automation/index.js';

export default new Home('新家')
  .addScopes({
    f1: new Floor('一楼').addScopes({
      livingRoom: new Room('客厅').addScopes({
        workingArea: new Area('工作区'),
        diningArea: new Area('餐厅'),
      }),
      bedroom: new Room('卧室').addScopes({
        balcony: new Area('阳台'),
      }),
    }),
  })
  // plugin may contain multiple functionalities.
  .addPlugins({
    xiaomi: new XiaomiPlugin(),
    cctv: new CCTVPlugin(),
  })
  .addDevices({
    'outdoor-cctv-1': new CCTVCamera('室外摄像头 1', {
      source: 'rtsp://...',
    }),
    'outdoor-cctv-2': new CCTVCamera('室外摄像头 2', {
      source: 'rtsp://...',
    }),
  })
  .addAutomations({
    ambientLight: new AmbientLightAutomation(),
  });
```

```ts
interface XiaomiDeviceManagerData {
  token: string;
}

class XiaomiDeviceManager extends DeviceManager {
  constructor(data: XiaomiDeviceManagerData | undefined) {
    super();
  }
}
```

**automation/light.js**

```ts
export class AmbientLightAutomation extends BatchStateAutomation {
  constructor() {
    this.select({
      type: 'light',
      tag: 'ambient',
    }).react((scope, device) => {
      return naturalLight.getLightState(device, scope.persons.length > 0);
    });
  }
}
```

```ts
export const ambientLightAutomation = $automation()
  .$device({
    type: 'light',
    tag: 'ambient',
  })
  .$state((scope, device) => {
    return naturalLight.getLightState(device, scope.persons.length > 0);
  });
```

```ts
home.state.temperature;
home.state.humidity;
home.state.persons;
home.state.animals;

home.f1.livingRoom.state.temperature;
home.f1.livingRoom.workingArea.state.temperature;
```

## 配置

```bash
homelib serve
```

## 基于状态的批量设备控制
