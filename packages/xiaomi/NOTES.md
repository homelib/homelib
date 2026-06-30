# Xiaomi MIoT 技术探索笔记

本文档记录了在 `@homelib/xiaomi` 开发过程中探索小米 MIoT 协议的关键技术经验，
供后续开发参考。

## 三种控制路径

| 路径         | 机制        | 延迟 | 依赖               | 适用场景         |
| ------------ | ----------- | ---- | ------------------ | ---------------- |
| 云端控制     | HTTP API    | 较高 | 需要互联网         | 所有设备，通用   |
| 网关本地控制 | mTLS MQTT   | 低   | 需中枢网关同局域网 | 有中枢网关的环境 |
| LAN 直连     | UDP OT 协议 | 最低 | 需设备 WiFi 直连   | WiFi IP 设备     |

控制优先级（AUTO 模式）：**网关本地 > LAN 直连 > 云端**

---

## 1. OAuth2 认证

### 流程

1. 生成授权 URL → 用户在浏览器中登录小米账号
2. 登录后重定向到回调 URL，携带 `code` 参数
3. 用 `code` 换取 `access_token` + `refresh_token`
4. Token 过期后用 `refresh_token` 刷新

### 关键细节

- **client_id** `2882303761520251711` 超过 JavaScript `Number.MAX_SAFE_INTEGER`。
  必须作为字符串保留，在 JSON 请求体中通过正则替换注入为原始数字：

  ```typescript
  const dataStr = JSON.stringify(data).replace(
    /"client_id":"[^"]*"/,
    `"client_id":${this.clientId}`,
  );
  ```

  否则 `Number("2882303761520251711")` 会变成 `2882303761520252000`，精度丢失。

- **Redirect URL** 必须是 `http://homeassistant.local:8123`（小米 OAuth 服务注册的固定值）。
  实际运行时需要启动本地 HTTP 服务器监听 8123 端口接收回调。

- **Token 有效期** 约 14 天，按 70% 比例计算 `expires_ts` 提前刷新：
  `expires_ts = now + expires_in * 0.7`

- **Token 响应** 可能包含 `mac_key` 字段（ha_xiaomi_home 代码中引用但未实际使用）。

### API 端点

| 端点                                           | 方法 | 用途                                   |
| ---------------------------------------------- | ---- | -------------------------------------- |
| `https://{host}/app/v2/ha/oauth/get_token`     | GET  | 换取/刷新 token                        |
| `https://open.account.xiaomi.com/user/profile` | GET  | 获取用户信息（昵称）                   |
| `/app/v2/homeroom/gethome`                     | POST | 获取家庭/房间/设备列表                 |
| `/app/v2/home/device_list_page`                | POST | 分页获取设备详情（含 token、local_ip） |
| `/app/v2/miotspec/prop/get`                    | POST | 读取设备属性                           |
| `/app/v2/miotspec/prop/set`                    | POST | 设置设备属性                           |
| `/app/v2/miotspec/action`                      | POST | 调用设备 action                        |
| `/app/v2/ha/oauth/get_central_crt`             | POST | 获取中枢网关用户证书（仅 CN）          |

### HTTP Headers

```
Authorization: Bearer{token}    ← 注意 Bearer 后无空格
X-Client-AppId: {clientId}
X-Client-BizId: haapi
Content-Type: application/json
```

### 返回码

- `code=0`：成功（部分设备如开关返回 `code=1` 也表示成功）
- 负数：错误（如 `-704083036` 表示 DID/siid 组合不正确）

### getDevices() 的 bug

设备详情（`getDeviceListPage` 返回）中 `home_id` 等字段为空，会覆盖 `getHomeInfos()` 中
设置的值。修复方式：合并时保留 home list 中设置的 home/room 字段：

```typescript
devices[did] = {
  ...detail,
  home_id: existing.home_id, // 保留
  home_name: existing.home_name,
  room_id: existing.room_id,
  room_name: existing.room_name,
  group_id: existing.group_id,
};
```

---

## 2. 云端 MQTT

- **Broker**: `mqtts://{cloudServer}-ha.mqtt.io.mi.com:8883`
- **认证**: username = app_id（OAuth2 client ID），password = access_token
- **协议**: MQTT v5，`rejectUnauthorized: false`（自签名 CA）
- **消息格式**: 明文 JSON（不像本地 MQTT 需要二进制打包）

### 订阅 Topic

| Topic                                  | 用途             |
| -------------------------------------- | ---------------- |
| `device/{did}/up/properties_changed/#` | 设备属性变更通知 |
| `device/{did}/up/event_occured/#`      | 设备事件通知     |
| `device/{did}/state/#`                 | 设备上下线状态   |

### 注意

- BLE 设备（`blt.*`）和代理网关子设备（`proxy.*`）不上报上下线状态，无需订阅。

---

## 3. 中枢网关本地控制（mTLS MQTT）

### 端口

- **独立网关**（`xiaomi.gateway.hub1`）：端口 **8883**
- **路由器内置网关**（`xiaomi.router.*`）：端口 **18883**

> ⚠️ 8883 端口在路由器上是管理界面的 TLS 服务，不是 MQTT broker！
> 通过检查服务器证书 CN 是否以 `mips.` 开头来区分。

### 用户证书

- **密钥算法**: Ed25519
- **CSR Subject**: `C=CN, O=Mijia Device, CN=mips.{uid}.{sha1(did)}.2`
  - `uid` = 用户 UID（从云端 API 获取）
  - `did` = virtual_did（随机 64 位整数）
  - `sha1(did)` = DID 的 SHA-1 哈希（hex 编码）
- **签发**: 通过云端 API `/app/v2/ha/oauth/get_central_crt` 提交 CSR，小米签发证书
- **有效期**: 约 14 天，需定期刷新
- **CSR 生成**: Node.js 无内置 CSR builder，使用 `openssl` CLI 生成

### MQTT 连接

- **Client ID**: virtual_did（与证书 CN 中的 did 一致）
- **Reply Topic**: `{virtual_did}/reply`
- **mTLS**: 需要提供 CA 证书、用户证书、用户私钥
- **CA 证书**: 小米 MIoT CA（硬编码在 `constants.ts` 的 `MIHOME_CA_CERT`）

### MIPS 二进制消息格式

本地 MQTT 的 payload 是**二进制 TLV 结构**，不是明文 JSON：

```
序列: [len:uint32_le][type:uint8][data]...
Type 0 = ID (uint32_le)
Type 1 = RET_TOPIC (string + \0)
Type 2 = PAYLOAD (string + \0)
Type 3 = FROM (string + \0)
```

### 控制命令

| 操作         | Topic                     | Payload 格式                                                              |
| ------------ | ------------------------- | ------------------------------------------------------------------------- |
| 获取属性     | `master/proxy/get`        | `{"did":"...","siid":2,"piid":1}`                                         |
| 设置属性     | `master/proxy/rpcReq`     | `{"did":"...","rpc":{"id":N,"method":"set_properties","params":[...]}}`   |
| 调用 action  | `master/proxy/rpcReq`     | `{"did":"...","rpc":{"id":N,"method":"action","params":{...}}}`           |
| 获取设备列表 | `master/proxy/getDevList` | `{"info":["name","model","urn","online","specV2Access","pushAvailable"]}` |

回复消息在 `{virtual_did}/reply` topic，使用相同的 MIPS 二进制格式打包。

### 属性变更订阅

Topic: `appMsg/notify/iot/{did}/property/#`
（注意：本地 MQTT 的 topic 格式与云端不同）

### 支持内置中枢网关的设备

截至 2025 年 11 月（来源: [Wiki](https://github.com/XiaoMi/ha_xiaomi_home/wiki/Central-hub-gateway-device-models)）：

| 型号                    | 发布时间 |
| ----------------------- | -------- |
| xiaomi.gateway.hub1     | 2022-03  |
| xiaomi.controller.oh10p | 2025-09  |
| xiaomi.router.rn04      | 2024-10  |
| xiaomi.router.rp01      | 2025-05  |
| xiaomi.router.rp02      | 2025-05  |
| xiaomi.router.rp04      | 2025-09  |
| xsmart.gateway.plc04    | 2024-08  |

---

## 4. 网关自动发现

### 发现流程

```
mDNS 发现 (_miot-central._tcp.local.)
    ↓ 失败（WSL/Docker 等环境）
OT probe 子网扫描 (UDP 54321)
    → 匹配云端获取的网关 DID
    → 对找到的 IP 检测 18883/8883 端口
    → 验证 TLS 证书 CN 是否以 "mips." 开头
```

### mDNS 发现

- 服务类型: `_miot-central._tcp.local.`
- TXT 记录中的 `profile` 字段（base64 编码）包含：
  - `[1:9]` did (uint64 big-endian)
  - `[9:17]` group_id (8 bytes, reversed for hex)
  - `[20]` role (upper nibble, 1 = central hub)
  - `[22]` suite_mqtt (bit 1)

### OT probe 子网扫描

- 向局域网所有 IP 发送 32 字节 UDP probe（端口 54321）
- Probe 格式: `0x2131` + length(32) + `0xFF*12` + `"MDID"` + virtual_did(8) + `\0*4`
- 设备响应: 头部包含设备 DID（bytes 4:12, big-endian uint64）
- 匹配响应 DID 与云端获取的候选网关 DID

### 候选网关筛选

从云端设备列表中筛选用户自己家庭下的设备：

```typescript
if (dev.model.includes('gateway') || dev.model.includes('router'))
```

### WSL 网络环境

- mDNS 多播在 WSL 中不工作
- 通过 Tailscale (100.x) + eth5 (192.168.31.x) 桥接访问局域网
- 子网扫描时跳过 Tailscale (100.x)、Docker (172.x)、/32 路由

---

## 5. LAN 直连控制（UDP OT 协议）

### 协议

- **端口**: 54321 (UDP)
- **加密**: AES-128-CBC
- **密钥派生**: `aes_key = MD5(token)`, `aes_iv = MD5(aes_key + token)`
- **设备 token**: 从云端设备列表获取（`device.token` 字段）

### 数据包格式

```
[0:2]   0x2131 (magic header)
[2:4]   总长度 (uint16 big-endian)
[4:12]  设备 DID (uint64 big-endian)
[12:16] 时间偏移 (uint32 big-endian)
[16:32] MD5 校验 (计算时用 token 替换此区域)
[32:]   AES-128-CBC 加密的 JSON payload (PKCS7 padding)
```

### 限制

- 仅适用于 **WiFi 直连 IP 设备**（有 `local_ip` 和 `token`）
- 不适用于 BLE Mesh、ZigBee 设备（通过网关连接，无 `local_ip`）
- 官方文档说"可能导致某些异常，不推荐使用"

---

## 6. 设备属性

### 常见属性映射

| 设备类型 | siid | piid | 属性              |
| -------- | ---- | ---- | ----------------- |
| 灯/开关  | 2    | 1    | on/off (bool)     |
| 灯       | 2    | 2    | brightness        |
| 灯       | 2    | 3    | color_temperature |

### 多路开关子设备

- DID 格式: `父设备DID.sN`（如 `1110622389.s2`）
- 控制时需用**父设备 DID**，不是子设备 DID
- `.s2` 对应 siid=3（第二个 switch service），不是 siid=2
- 子设备 DID 直接调用 API 会返回错误码 `-704083036`

### 设备 Spec 查询

```
GET https://miot-spec.org/miot-spec-v2/instance?type={urn}
```

返回 JSON 包含所有 service/property/action 的定义。

---

## 7. 文件结构

```
packages/xiaomi/src/
├── library/                    # 库模块
│   ├── constants.ts             # 常量（client_id、CA 证书、端口等）
│   ├── oauth-client.ts          # OAuth2 认证
│   ├── http-client.ts           # 云端 HTTP API
│   ├── mqtt-client.ts           # 云端 MQTT 客户端
│   ├── cert-manager.ts          # 证书管理（Ed25519 密钥、CSR、存储）
│   ├── mdns-discovery.ts        # 网关发现（mDNS + 子网扫描）
│   ├── local-mqtt-client.ts     # 本地 MQTT 客户端（mTLS + MIPS 二进制）
│   ├── lan-client.ts            # LAN 直连客户端（UDP OT 协议）
│   └── index.ts                 # 统一导出
└── experiments/                 # 实验脚本
    ├── shared.ts                 # 共享工具（token 缓存、目标设备）
    ├── demo-cloud.ts             # Demo 1: 云端控制
    ├── demo-gateway.ts           # Demo 2: 网关本地控制
    ├── demo-lan.ts               # Demo 3: LAN 直连控制
    ├── control-light.ts          # 完整流程实验
    ├── toggle-device.ts          # 单设备控制
    └── inspect-device.ts         # 设备属性探测
```

---

## 8. 调试经验

### "Not authorized" 问题排查

1. 检查 TLS 握手是否成功（证书是否正确）
2. 检查 MQTT CONNECT 的 client_id 是否与证书 CN 中的 did 一致
3. **检查端口号**：路由器内置网关用 18883，不是 8883
4. 通过服务器证书 CN 区分：MQTT broker 的 CN 以 `mips.` 开头
5. 搜索 GitHub Issues 社区信息：issue #1679 的 debug 日志暴露了 18883 端口

### 精度丢失问题

`Number("2882303761520251711")` → `2882303761520252000`（精度丢失）
解决：保持字符串，JSON 序列化后正则替换为原始数字。

### getDevices() home_id 丢失

设备详情覆盖了 home list 设置的 home_id。解决：合并时显式保留 home 字段。

---

## 9. 参考资料

- [ha_xiaomi_home 官方集成](https://github.com/XiaoMi/ha_xiaomi_home)
- [中枢网关设备型号列表](https://github.com/XiaoMi/ha_xiaomi_home/wiki/Central-hub-gateway-device-models)
- [MIoT Spec 查询](https://miot-spec.org)
- Issue #1438: 中枢网关型号列表
- Issue #1679: 路由器内置网关 MQTT 端口 18883
