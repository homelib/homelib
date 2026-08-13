# @homelib/xiaomi

Xiaomi MIoT 智能家居 provider。将包纳入 homelib 后，在终端中添加并授权 MIoT provider；OAuth 会话、设备发现和家庭筛选均由 provider 管理。

## 控制方式

### 云端控制

provider 通过 Xiaomi 云端服务发现设备、读取状态和执行控制。授权完成后，无需在应用中直接管理 OAuth client、access token 或 HTTP client。

### 中枢网关本地控制（mTLS MQTT）

中国大陆账号的 MIoT provider 会自动启用本地 MQTT：复用已缓存的完整设备列表，通过 mDNS 与局域网探测发现中枢，自动签发并轮换 mTLS 证书，再按设备能力动态选择本地或云端路由。属性快照、属性通知和事件通知优先使用可用的本地链路；本地控制请求在发布前不可路由时才安全回退到云端。

支持独立网关、路由器内置网关和中枢控制器。证书按 provider 隔离保存在 homelib 私有目录中，无需脚本管理。

当前本地路径仅支持中枢网关的 mTLS MQTT。历史 LAN 直连（UDP OT）客户端不再作为本包 API 提供。

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
