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

新建的 SSO 用户首次登录后需设置 12–72 字节的平台密码，设置前不能进行密码登录或访问受保护路由；此前已有账号不受影响。用户接口不返回平台内部 `sub`。

## 目录结构

```text
cmd/api/              服务入口、启动与退出
internal/config/      环境变量配置及校验
internal/database/    GORM 数据库连接器
internal/model/       GORM 实体，供业务与迁移共用
internal/dto/         接口请求、响应及 SSO 上游数据结构
internal/auth/        登录、会话及学校 SSO
internal/activity/    活动首页聚合、新建立项与项目基础详情
internal/migration/   全局迁移执行器
internal/migrations/  按版本登记的迁移文件
internal/httpapi/     路由、中间件及统一响应
web/                  React 登录、个人信息与活动管理首页
docs/                 项目方案、任务拆解与 openapi.yaml 接口契约
```

数据库实体定义在 `internal/model/`，迁移直接引用 model，不依赖业务包。接口 DTO 按用途放在 `internal/dto/`；DTO 不参与 GORM 迁移，响应不包含内部用户 sub、密码哈希或会话令牌摘要。

## 活动管理前端

接口契约见 [`docs/openapi.yaml`](docs/openapi.yaml)，覆盖现有 6 条认证路由与 4 条活动接口：`GET /api/v1/activity/dashboard`、`GET /api/v1/activity/projects`、`POST /api/v1/activity/projects`、`GET /api/v1/activity/projects/{id}`。台账接口在授权范围内支持搜索、十二状态与部门筛选、分页和全范围统计。

前端入口 `/activity` 沿用 `web/preview/` 设计。活动管理员登录后默认进入首页，仅查看本人创建项目；超管查看全部项目，其他用户仍进入个人信息。后端强制校验会话、首次设密和角色，并按创建人限制查询；越权读取详情与不存在项目均返回 404。

前端已覆盖登录、首次设密、个人信息、工作台、项目台账、项目详情、招募草稿、时长登记草稿、材料实时预览与公开报名版式。持久化立项、项目查询和台账使用真实 API；招募、场次、时长与材料仅保存本次会话草稿，刷新或退出后清除。公开报名尚未开放服务器提交，填写预览不发送报名。认定时长为 null，不使用演示值。状态变更、协作授权与最终审核待接入，完整边界见前端 README。版本3新增 `projects` 表，启动时由全局迁移执行器应用，不需要手动建表。

活动接口集成测试使用临时内存 SQLite，执行 `go test -tags integration ./...`。前端测试、构建命令见 [`web/README.md`](web/README.md)。

## 检查

### 回调、迁移与调试日志

学校登记回调保持 `SSO_REDIRECT_URI=http://localhost:8080/auth/sso/callback`；登录结束后由后端跳转到 `FRONTEND_URL`（默认 `http://localhost:5173`）及已保存的站内路径。失败提示也回到前端登录页。部署时将 FRONTEND_URL 配成实际前端域名，不能带查询串或页面路径。

开发数据库默认是 `data/volun-data.db`（SQLite），通过 GORM 访问；生产使用 PostgreSQL。`users.sub` 是主键，`users.id` 是学号，`sessions.user_id` 关联的是 sub。旧本地主键保留原值，不会凭账号名自动合并已有 SSO 身份。

迁移由全局 `internal/migration/runner.go` 管理，具体版本文件放在 `internal/migrations/`，`schema_migrations` 保存 version、name、applied_at。版本1兼容旧表并建立内部 sub 主键结构；版本2新增 SSO 首次登录必须设置密码标记。升级在事务中执行，已记录版本不再重复执行。新增表结构需追加新编号迁移，不能修改已发布版本含义；暂不提供自动降级，数据库版本高于程序时启动失败。正式升级前按部署流程备份。

全局 `internal/observability/upstream.go` 负责 SSO 上游诊断和前端安全跳转，不依赖 auth 业务类型。在 `.env` 设置 `LOG_LEVEL=debug` 后重启，可查看 SSO 授权端点、client_id、redirect_uri、scope、回调参数是否存在、state 校验、Token/UserInfo 上游地址、HTTP 状态、耗时、响应字段名及本地身份解析和最终跳转。日志不会输出 client_secret、code、state、nonce、Token、Cookie、原始响应正文。通过 request_id 关联同一回调中的阶段；默认 info 不输出这些调试细节。

开发管理员仅在 `APP_ENV=dev` 时初始化，并在每次启动时输出当前登录账号和密码；启动会将已有本地开发账号密码同步为 `DEV_ADMIN_PASSWORD`（默认 `change-me`）。生产和 test 模式不初始化或打印该账号。

SSO 用户以平台 `sub` 为数据库主键，`id` 保存 `student_number` 字符串，保留前导零；会话关联 `sub`。请为应用申请 `student_number` scope，并在 `.env` 的 `SSO_SCOPES` 中包含它，否则平台可能不返回学号，此时 `id` 留空。旧表升级保留旧主键和会话；旧 SSO 账号不按 username 自动认领为新 sub，必要时人工核对历史记录。

SSO 本地联调需要在启动后端的同一个 PowerShell 中配置真实应用凭据：

```powershell
$env:SSO_CLIENT_ID = '<平台分配的 client_id>'
$env:SSO_CLIENT_SECRET = '<平台分配的 client_secret>'
$env:SSO_REDIRECT_URI = 'http://localhost:5173/sso/callback'
go run ./cmd/api
```

另一个终端执行 `cd web`、`yarn install --frozen-lockfile`、`yarn dev`，浏览器使用 `http://localhost:5173`。上述回调经 Vite 代理交给 Go，随后返回前端首页；平台也必须允许并登记这个完整地址。若已登记的是 `http://localhost:8080/auth/sso/callback`，回调后的 `/` 会落在后端端口，当前后端未提供前端首页，需要返回 5173 查看登录状态。不要混用 localhost 和 127.0.0.1。

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

Migration v0 initializes a new database; v1 upgrades legacy primary keys. Existing databases already recorded at v1 retain their history and do not rerun v0.
Dev startup ensures the administrator exists and logs sub/id/username/groups at info; the login password is printed only with LOG_LEVEL=debug. Production does not seed or print development credentials.

???????? `internal/errhandler/codes.go`????? `errhandler.Fail` ?????`errhandler.OK` ??????????? request_id????????? dev ??? INFO ?? `development account ready` ?????? username?password?sub?id ? groups?
