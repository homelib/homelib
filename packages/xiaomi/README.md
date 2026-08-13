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

中国大陆账号的 MIoT provider 会自动启用本地 MQTT：复用已缓存的完整设备列表，通过 mDNS 与局域网探测发现中枢，自动签发并轮换 mTLS 证书，再按设备能力动态选择本地或云端路由。属性快照、属性通知和事件通知优先使用可用的本地链路；本地控制请求在发布前不可路由时才安全回退到云端。

支持独立网关、路由器内置网关和中枢控制器。证书按 provider 隔离保存在 homelib 私有目录中，无需脚本管理。

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
