---
name: cloudflare-wrangler
description: 本机使用 wrangler / Cloudflare API 的操作约定（凭据、npx 运行方式、沙箱坑位）。USE FOR: 运行 wrangler 任何子命令、部署 Pages/Workers、查询 Cloudflare 账号/zone、遇到 "You are not authenticated" 或 EROFS/10000/9109 等凭据类错误时。
---

# Cloudflare / Wrangler 操作约定

## 执行方式（用户明确要求）

- **一律用 `npx wrangler@latest <cmd>` 执行**，不追求全局安装，不自己绕路。
- **凭据只用存储凭据**：`~/.config/.wrangler/config/default.toml`（`wrangler login` 产生的 oauth_token + refresh_token）。
- **禁止**自己调 OAuth token 端点手动 refresh、禁止把 token 从配置里抠出来手动塞给 curl/API、禁止用过期/轮换过的旧 token 重试。
- **遇到认证问题（"You are not authenticated"、code 9109/10000）→ 停下来问用户**，请用户重新跑 `npx wrangler@latest login`，不要自行补救。
- 沙箱只读文件系统导致的 EROFS（~/.npm、~/.config 写日志）属基础设施问题，可用 `npm_config_cache=/tmp/npmcache` 绕过，但这与凭据无关，不算"绕路"。

## 已踩过的坑（先排查这些再怀疑别的）

1. **环境残留变量**：会话/沙箱环境可能残留 `XDG_CONFIG_HOME=/tmp/...`、`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`，会让 wrangler 读错配置目录或覆盖存储凭据。干净跑法：
   ```bash
   env -u XDG_CONFIG_HOME -u CLOUDFLARE_API_TOKEN -u CLOUDFLARE_ACCOUNT_ID npx wrangler@latest whoami
   ```
   先 `env | grep -Ei 'home|cloudflare|xdg'` 检查。
2. **bash 大输出会被吞**：一律 `> /tmp/xxx.out 2>&1` 再 `cat`。
3. `~/.config` 只读时 wrangler 写日志报 EROFS，**是非致命警告**，whoami/deploy 仍会成功，忽略即可。
4. `CI=true` 可跳过 wrangler 结尾的 AI-skill 安装交互提示（否则命令挂住）。
5. **wrangler 4.x 已移除 `zones` / `dns` 子命令**（4.124.0 验证），列 zone / DNS 记录要用 Cloudflare API 或 Dashboard；只读 token 下 dns_records API 会 403/10000，属权限问题不是异常。
6. Pages 项目列表端点不支持 `per_page`。
7. 判断自定义域名是否生效用**公共 DoH**（`https://dns.google/resolve?name=xxx&type=A`）+ curl 站点；本机（WSL）resolver 有负缓存，用 `curl --resolve host:443:<边缘IP>` 直连验证。

## homelib website 部署速查

- Pages 项目：`homelib-website`（account `ca460ca2dd53b5a2335003df88d0db8f` / Songheng Wan，production_branch=master）。
- 自定义域名 `www.homelib.dev` 已绑定（zone homelib.dev 归属另一账号，本 token 仅 zone:read；DNS 记录由用户手动管理，现为代理 A 记录）。
- 构建：`cd /home/vilicvane/projects/homelib/homelib && npm run --workspace @homelib/website website:build` → 产物 `packages/website/.bld/www`。
- 部署（在仓库目录）：`env -u XDG_CONFIG_HOME -u CLOUDFLARE_API_TOKEN -u CLOUDFLARE_ACCOUNT_ID npx wrangler@latest pages deploy packages/website/.bld/www --project-name=homelib-website --commit-dirty=true`。
- 验证：`curl https://homelib-website.pages.dev` 与 `curl https://www.homelib.dev` 均 200。
