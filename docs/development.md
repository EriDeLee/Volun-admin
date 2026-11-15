# 本地开发与检查

## 环境与首次启动

- Go **1.26.4+**，版本依据根目录 `go.mod`。
- Node.js **24 LTS**，Yarn **1.22.22**。当前 Vitest、jsdom 和 Vite 的运行要求不同，统一使用 Node 24 可同时运行开发、测试与构建。
- 本地默认 SQLite，使用纯 Go 驱动；生产使用 PostgreSQL。

从仓库根目录启动，服务会读取该目录的 `.env`；显式环境变量优先。

```sh
git clone https://github.com/EriDeLee/Volun-admin.git
cd Volun-admin
cp .env.example .env
go mod download
go run ./cmd/api
```

PowerShell 复制文件使用 `Copy-Item .env.example .env`。学校 SSO 并非本地密码登录的前置条件。

另开终端：

```sh
cd Volun-admin/web
yarn install --frozen-lockfile
yarn dev
```

访问 <http://localhost:5173>，使用本地开发账号 `admin` / `change-me`。修改 `.env` 后重启后端。后端监听 `:8080`，数据库默认位于 `data/volun-data.db`；首次连接自动创建并迁移。

## 提交前检查

前端修改在 `web/` 执行：

```sh
yarn test
yarn format:check
yarn build
yarn test:browser
```

`build` 包含严格 TypeScript 检查，产物位于 `web/dist/`。浏览器检查会启动独立 Vite 服务并模拟 API，不需要真实账号或运行后端；覆盖台账、导航、主题、桌面与手机布局。浏览器配置及旧场景脚本见[前端说明](../web/README.md#浏览器检查)。

后端修改在仓库根目录执行：

```sh
go test ./...
go vet ./...
go build -o bin/api ./cmd/api
go test -tags integration ./...
```

集成测试使用临时内存 SQLite。SQLite 检查不能替代 PostgreSQL 验证；生产迁移、SQL 和事务行为需在 PostgreSQL 单独验证。模拟浏览器测试不能替代真实学校 SSO 联调。

## 常见问题

| 现象 | 检查与处理 |
| --- | --- |
| 前端提示连接失败或代理报错 | 先访问 `http://localhost:8080/healthz`，确认 Go 服务在 8080；Vite 代理配置位于 `web/vite.config.ts` |
| `/api/v1/auth/me` 返回 401 | 未登录时属正常；登录后检查 Cookie、主机名是否一致，避免混用 `localhost` 与 `127.0.0.1` |
| SSO 回调返回页面或 404 | 使用 `/auth/sso/callback`，与平台登记值逐字一致；本地推荐 `http://localhost:5173/auth/sso/callback`，不要省略 `/auth` |
| 手机扫二维码无法访问 | `FRONTEND_URL` 使用手机可达的局域网 IP 或域名，修改后重启后端；手机与电脑需能互通 |
| `yarn test:browser` 找不到浏览器 | 设置 `BROWSER_EXECUTABLE_PATH`、`BROWSER_CHANNEL` 或安装 Playwright Chromium，见[前端说明](../web/README.md#浏览器检查) |
| Node 引擎版本不匹配 | 切换到 Node 24 LTS 后重新运行 `yarn install --frozen-lockfile` |
| Windows 缓存盘空间不足 | 将 `YARN_CACHE_FOLDER`、`TEMP`、`TMP` 指向可写且有空间的目录 |

## 目录结构

```text
cmd/api/              服务入口、启动与退出
internal/config/      环境变量配置及校验
internal/database/    GORM 数据库连接器
internal/model/       GORM 实体，供业务与迁移共用
internal/dto/         接口请求、响应及 SSO 上游数据结构
internal/auth/        登录、会话
internal/sso/         学校 SSO 对接
internal/admin/       超管用户管理
internal/activity/    项目台账、立项审批、招募、出勤、时长、材料
internal/errhandler/  统一错误码与响应
internal/migration/   全局迁移执行器
internal/migrations/  按版本登记的迁移文件
internal/observability/ SSO 上游诊断与前端安全跳转
internal/httpapi/     路由、中间件及统一响应
web/                  React 管理端
docs/                 设计文档与 openapi.yaml
```

数据库实体定义在 `internal/model/`，迁移直接引用 model，不依赖业务包。DTO 不参与迁移，响应不包含内部 `sub`、密码哈希或会话令牌摘要。

## 数据库迁移

- 由 `internal/migration/runner.go` 执行，版本文件在 `internal/migrations/`，已应用版本记录在 `schema_migrations`（version、name、applied_at）。
- 当前版本：v0 新库初始化；v1 升级旧主键结构（已记录 v1 的库不会重跑 v0）；v2 SSO 首次设密标记；v3 `projects` 表；v4 工作流、事件、材料版本及参与凭证表；v5 手机号唯一索引。
- 升级在事务中执行，已记录版本不重复执行。新增结构须追加新编号迁移，不得修改已发布版本含义；暂无自动降级，数据库版本高于程序时启动失败。正式升级前请按部署流程备份。


## 修改约定

- 保持接口与 [OpenAPI](openapi.yaml)、权限及状态流转文档一致，未实现项继续明确标识。
- 前端使用共享 `WorkspaceShell`、`Sidebar`、`Modal` 和主题变量；不要在新页面复制页面外壳。详见[前端界面约定](../web/README.md#界面维护)。
- 涉及行为变化时增加针对用户行为的回归检查；纯样式调整通过桌面、手机及浅深主题截图验证。
- 不提交 `.env`、本地数据库、依赖、构建产物或浏览器截图。新增依赖使用 Yarn 并更新 `yarn.lock`。

返回[文档导航](README.md)
