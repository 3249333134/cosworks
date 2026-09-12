# 入戏局

前后端分离的多人角色聚会游戏。房主同时是正常玩家，可在同一设备的极简游戏舞台中打开控场抽屉。

## 本地开发

1. 安装 Node.js 22 与 pnpm。
2. 复制 `apps/server/.env.example` 为 `apps/server/.env`，开发环境默认使用内存数据源。
3. 运行 `pnpm install`。
4. 运行 `pnpm dev`，访问 `http://localhost:5173`。

## 本地联调远端真实数据

本模式只在本机运行前端、API 和 WebSocket。MySQL 与 Redis 通过 SSH 隧道访问服务器上的隔离资源；不会开放公网数据库端口，也不会重新部署网站。

1. 首次执行 `pnpm remote-dev:init`。它会创建或复用远端 `cosworks_dev`、最小权限账号 `cosworks_dev_app` 和 Redis DB1，并生成被 Git 忽略的 `apps/server/.env.remote-dev`。
2. 需要重新匹配线上快照时执行 `pnpm remote-dev:refresh`，并输入确认词 `REFRESH`。该操作只重建 `cosworks_dev` 和 Redis DB1；Redis 在线状态键不会复制。
3. 执行 `pnpm remote-dev:start`，浏览器访问 `http://localhost:5173`。此命令隐藏启动 `13306 -> 3306`、`16379 -> 6379` 两条 SSH 隧道，再启动前后端。
4. 应用运行时可另开终端执行 `pnpm remote-dev:check`，验证最小权限 MySQL、Redis DB1、API 和 WebSocket。
5. 正常结束 `remote-dev:start` 会自动停止隧道；异常退出后可执行 `pnpm remote-dev:stop`，它只停止本项目 PID 文件记录的 SSH 进程。

普通 `pnpm dev` 仍使用内存数据源。远端联调若隧道不可用会明确失败，不会回退到内存模式。初始化和刷新均在服务器内部复制 MySQL，不会在本机生成数据库导出文件。

## 验证

```bash
pnpm typecheck
pnpm test
pnpm build
```

## 生产部署

- MySQL 执行 `apps/server/schema.sql`，为应用创建仅限 `cosworks.*` 的独立账号。
- 发布前运行 `pnpm build`，再执行 `node node_modules/.pnpm/esbuild@0.25.12/node_modules/esbuild/bin/esbuild apps/server/src/index.ts --bundle --platform=node --format=cjs --outfile=apps/server/bundle/index.cjs`；生产镜像只复制已验证产物，不在服务器安装依赖。
- 将真实环境变量保存到 `/opt/cosworks/shared/.env.production`，权限设为 `600`。
- 创建外部 Docker 网络 `cosworks-net`，把已有 MySQL、Redis 接入后运行 `deploy/deploy.sh`。当前服务器的 80/443 已由公共 Nginx 网关占用，脚本会备份其 IP 专用配置，仅将 `47.115.220.98` 的请求热加载转发到 `cosworks-web`，不会替换既有域名站点。
- 安装并启用 `deploy/cosworks-firewall.service`，通过 `DOCKER-USER` 链仅阻止公网接口访问 3306/6379，不影响容器网络。
- 生产前轮换所有曾通过聊天或命令行共享过的密码。

前端构建只包含 `/api` 和 `/ws` 两个公开入口，不包含数据库、Redis、SSH 或 AI 密钥。
