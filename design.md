# Design

**package.json**

```json
{
  "type": "module",
  "exports": {
    ".": "./home.js",
    "dashboard": "./dashboard.json"
  }
}
```

**home.js**

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
  .automations([$ambientLightAutomation()])
  .cards([
    $lightCard('客厅主灯').binds({
      light: $('客厅', '主灯'),
    }),
  ]);
```

- `Device` creates `DeviceEndpoint`.
- `DeviceEndpoint` defines observable device states.
- dashboard card (defined on scope):
  - interacts with current `Scope`.
  - interacts with both `DeviceEndpoint` object and its `Endpoint` clusters (using query?).

```ts
const lightCard = $constructor(
  class LightCard extends Card {
    constructor(name: string) {
      super(
        name,
        fileURLToPath(new URL('react/light-card.jsx', import.meta.url)),
      );
    }
  },
).build(card =>
  card.devices({
    light: $multiple(Light),
  }),
);
```

```tsx
export default function LightCard({
  devices: {light: lights},
  scope,
}: CardProps<typeof $lightCard>) {
  const defaultName = scope.name + '灯';

  const on = lights.every(light => light.on);

  return (
    <Card defaultName={defaultName} onClick={useEvent(() => light.toggle())}>
      {on ? '开' : '关'}
    </Card>
  );
}
```

```ts

```

```sh

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
