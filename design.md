**home.js**

1. new 实例化 + 完整方法名 + 键值对风格定义

```ts
export default new Home('新家')
  .addScopes({
    'living-room': new Room('客厅').addScopes({
      'working-area': new Area('工作区').addDevices({
        'main-light': new Light('主灯'),
        'desk-light': new Light('台灯'),
      }),
      'dining-area': new Area('餐厅'),
    }),
    bedroom: new Room('卧室').addScopes({
      balcony: new Area('阳台'),
    }),
  })
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

2. $ 实例化 + 简写方法名 + 键值对风格定义

```ts
export default $home('新家')
  .scopes({
    'living-room': $room('客厅').scopes({
      'working-area': $area('工作区').devices({
        'main-light': $light('主灯'),
        'desk-light': $light('台灯'),
      }),
      'dining-area': $area('餐厅'),
    }),
    bedroom: $room('卧室').scopes({
      balcony: $area('阳台'),
    }),
  })
  .plugins({
    xiaomi: $xiaomiPlugin(),
    cctv: $cctvPlugin(),
  })
  .devices({
    'outdoor-cctv-1': $cctvCamera('室外摄像头 1', {
      source: 'rtsp://...',
    }),
    'outdoor-cctv-2': $cctvCamera('室外摄像头 2', {
      source: 'rtsp://...',
    }),
  })
  .automations({
    ambientLight: $ambientLightAutomation(),
  });
```

3. new 实例化 + 完整方法名 + 数组风格定义

```ts
export default new Home('新家')
  .addScopes([
    new Room('客厅').addScopes([
      new Area('工作区').addDevices([new Light('主灯'), new Light('台灯')]),
      new Area('餐厅'),
    ]),
    new Room('卧室').addScopes([new Area('阳台')]),
  ])
  .addPlugins([new XiaomiPlugin(), new CCTVPlugin()])
  .addDevices([
    new CCTVCamera('室外摄像头 1', {
      source: 'rtsp://...',
    }),
    new CCTVCamera('室外摄像头 2', {
      source: 'rtsp://...',
    }),
  ])
  .addAutomations([new AmbientLightAutomation()]);
```

4. new 实例化 + 简写方法名 + 数组风格定义

```ts
export default new Home('新家')
  .scopes([
    new Room('客厅').scopes([
      new Area('工作区').devices([new Light('主灯'), new Light('台灯')]),
      new Area('餐厅'),
    ]),
    new Room('卧室').scopes([new Area('阳台')]),
  ])
  .plugins([new XiaomiPlugin(), new CCTVPlugin()])
  .devices([
    new CCTVCamera('室外摄像头 1', {
      source: 'rtsp://...',
    }),
    new CCTVCamera('室外摄像头 2', {
      source: 'rtsp://...',
    }),
  ])
  .automations([new AmbientLightAutomation()]);
```

5. $ 实例化 + 简写方法名 + 数组风格定义

```ts
export default $home('新家')
  .scopes([
    $room('客厅').scopes([
      $area('工作区').devices([$light('主灯'), $light('台灯')]),
      $area('餐厅'),
    ]),
    $room('卧室').scopes([$area('阳台')]),
  ])
  .plugins([$xiaomiPlugin(), $cctvPlugin()])
  .devices([
    $cctvCamera('室外摄像头 1', {
      source: 'rtsp://...',
    }),
    $cctvCamera('室外摄像头 2', {
      source: 'rtsp://...',
    }),
  ])
  .automations([$ambientLightAutomation()]);
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
