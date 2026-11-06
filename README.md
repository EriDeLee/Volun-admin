# 高校志愿服务项目管理平台

面向学校及学院志愿服务管理部门的项目管理平台，目标是将分散在表格和不同工具中的立项、招募、志愿者登记、服务时长、材料生成及审核归档流程集中管理。

## 项目范围

项目规划包含项目台账与十二种业务状态、志愿者手动及问卷登记、二维码访问、批量招募与时长录入、时长复核、历史数据迁移、审核记录、基础统计，以及立项申请材料生成。志愿服务时长由管理人员人工登记，不提供实时计时；报名、保存时长或下载材料不会自动推进审核流程。

系统设计采用四类用户组：超管、数据管理员、活动管理员和正式用户。学校统一认证使用 SSO 授权码流程；公开问卷登记不要求先登录。

## 当前实现

当前仓库包含 Go + Gin + GORM 后端、开发用 React 登录页，以及账号密码登录、本地会话、登出和学校 SSO 授权码登录流程。开发模式会初始化认证表并创建默认管理员账号；生产模式要求 PostgreSQL，SSO 需配置上游凭据。项目台账、招募、时长、材料等业务模块仍未实现，详见 [`docs/project-proposal.md`](docs/project-proposal.md) 和 [`docs/task-01-auth-and-sso.md`](docs/task-01-auth-and-sso.md)。

## 环境要求

- Go 1.26.4 或更新版本
- 开发默认 SQLite（纯 Go 驱动，无需单独安装 SQLite 服务或 C 编译器）
- 生产环境使用 PostgreSQL

## 本地运行

在仓库根目录执行：

```powershell
go mod download
go run ./cmd/api
```

服务默认监听 `:8080`，SQLite 默认数据库文件为 `data/volun-data.db`。数据库文件会在首次连接时创建；服务启动会初始化认证所需的数据表，其他业务表尚未实现。

```powershell
Invoke-RestMethod http://localhost:8080/healthz
Invoke-RestMethod http://localhost:8080/readyz
Invoke-RestMethod http://localhost:8080/api/v1/ping
```

- `/healthz` 检查进程存活。
- `/readyz` 检查数据库连接，失败时返回 HTTP 503。
- `/api/v1/ping` 返回版本化 API 示例。

## 配置

服务自动读取启动工作目录下的 `.env`，显式环境变量优先。请在仓库根目录启动，可将 `.env.example` 复制为 `.env` 后填写；`.env.example` 本身不自动加载。例如：

```powershell
$env:APP_ENV = 'dev'
$env:DB_DRIVER = 'sqlite'
$env:SQLITE_PATH = 'data/local.db'
$env:HTTP_ADDR = ':8080'
go run ./cmd/api
```

开发模式默认账号为 `admin`，默认密码为 `change-me`。该凭据仅供本地开发，部署环境应设置独立的 `DEV_ADMIN_PASSWORD`；不要将开发默认凭据用于生产。

生产环境必须使用 PostgreSQL，且不会回退到 SQLite：

```powershell
$env:APP_ENV = 'prod'
$env:DB_DRIVER = 'postgres'
$env:DATABASE_URL = 'postgres://USER:PASSWORD@HOST:5432/volun_data?sslmode=verify-full'
go run ./cmd/api
```

SSO 使用的 `SSO_CLIENT_ID`、`SSO_CLIENT_SECRET`、`SSO_REDIRECT_URI` 及上游地址通过环境变量配置；连接池、超时和变量清单见 [`.env.example`](.env.example)。生产部署应按环境配置 TLS、证书和可信代理。

## 目录结构

```text
cmd/api/              服务入口、启动与退出
internal/config/      环境变量配置及校验
internal/database/    GORM 数据库连接器
internal/auth/        登录、会话及学校 SSO
internal/httpapi/     路由、中间件及统一响应
web/                  React 登录页
docs/                 项目方案与任务拆解
```

## 检查

SSO 本地联调需要在启动后端的同一个 PowerShell 中配置真实应用凭据：

```powershell
$env:SSO_CLIENT_ID = '<平台分配的 client_id>'
$env:SSO_CLIENT_SECRET = '<平台分配的 client_secret>'
$env:SSO_REDIRECT_URI = 'http://localhost:5173/sso/callback'
go run ./cmd/api
```

另一个终端执行 `cd web`、`npm install`、`npm run dev`，浏览器使用 `http://localhost:5173`。上述回调经 Vite 代理交给 Go，随后返回前端首页；平台也必须允许并登记这个完整地址。若已登记的是 `http://localhost:8080/auth/sso/callback`，回调后的 `/` 会落在后端端口，当前后端未提供前端首页，需要返回 5173 查看登录状态。不要混用 localhost 和 127.0.0.1。

根目录 `.env` 自动加载，系统环境变量优先；更改配置后要重启后端。启动日志只报告凭据是否已配置，不输出凭据。未登录时 `/auth/me` 返回 401 是正常行为；SSO 发起正常返回 302，缺少配置时返回 303 到 `/login?sso=unavailable`。Vite 固定5173端口并代理到127.0.0.1:8080，修改代理配置后也请重启前端。

```powershell
go test ./...
go vet ./...
go build -o bin/api.exe ./cmd/api
```

开发环境 SQLite 检查不能替代 PostgreSQL 集成验证。数据库迁移、生产 SQL 及事务行为应在后续开发中单独验证。

## 许可证

本项目采用 Apache License 2.0，详见 [`LICENSE`](LICENSE)。

\n
