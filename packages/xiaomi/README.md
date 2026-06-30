# @homelib/xiaomi

Xiaomi MIoT 智能家居集成库，支持三种设备控制路径。

## 控制方式

### 1. 云端控制（HTTP API）

通过小米云 HTTP API 控制设备，无需局域网访问。

```typescript
import {
  XiaomiHttpClient,
  XiaomiOAuthClient,
  OAUTH2_CLIENT_ID,
} from '@homelib/xiaomi';

const oauth = new XiaomiOAuthClient({cloudServer: 'cn', uuid, redirectUrl});
const auth = await oauth.getAccessToken(code);

const http = new XiaomiHttpClient({
  cloudServer: 'cn',
  clientId: OAUTH2_CLIENT_ID,
  accessToken: auth.access_token,
});

await http.setProp(did, 2, 1, true); // 开灯
```

### 2. 中枢网关本地控制（mTLS MQTT）

通过局域网内的中枢网关控制设备，不经过小米云。支持独立网关和路由器内置网关。

```typescript
import {
  XiaomiLocalMqttClient,
  XiaomiCertManager,
  discoverGatewaysWithFallback,
} from '@homelib/xiaomi';

// 自动发现网关（mDNS → 子网扫描）
const gateways = await discoverGatewaysWithFallback([gatewayDid]);
const gw = gateways[0];

// 连接网关
const local = new XiaomiLocalMqttClient({
  did: virtualDid,
  host: gw.address,
  port: gw.port, // 8883 或 18883
  caFile,
  certFile,
  keyFile,
});

await local.connect();
await local.setProp(did, 2, 1, true); // 开灯（本地）
```

### 3. LAN 直连控制（UDP OT 协议）

直接与 WiFi 设备通信，不经过网关或云端。仅适用于 WiFi 直连 IP 设备。

```typescript
import {XiaomiLanClient} from '@homelib/xiaomi';

const lan = new XiaomiLanClient({did, token, ip: '192.168.31.x'});
await lan.init();
await lan.probe();
await lan.setProp(did, 2, 1, true); // 开灯（直连）
```

## 关键技术要点

- **OAuth2 client_id** 超过 `Number.MAX_SAFE_INTEGER`，需作为字符串处理。
- **路由器内置网关** MQTT 端口为 **18883**（非 8883），通过证书 CN 以 `mips.` 开头识别。
- **网关自动发现**：mDNS 优先，WSL/Docker 下回退到 OT probe 子网扫描。
- **用户证书**：Ed25519 密钥，CN = `mips.{uid}.{sha1(did)}.2`，有效期约 14 天。
- **设备 spec** 查询：`https://miot-spec.org/miot-spec-v2/instance?type={urn}`

## 参考

- [ha_xiaomi_home 官方集成](https://github.com/XiaoMi/ha_xiaomi_home)
- [中枢网关设备型号列表](https://github.com/XiaoMi/ha_xiaomi_home/wiki/Central-hub-gateway-device-models)

## License

MIT License.
