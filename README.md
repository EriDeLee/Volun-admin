# 高校志愿服务项目管理平台

面向学校及学院志愿服务管理部门的项目管理平台，将分散在表格和各类工具中的立项、招募、志愿者登记、服务时长、材料生成及审核归档流程集中管理。

## 项目范围

- 项目台账与十二种业务状态；志愿者手动及问卷登记、二维码访问；批量招募与时长录入、复核；审核记录与基础统计；立项申请材料生成。
- 服务时长由管理人员人工登记（整数小时），不提供实时计时。报名、签到、保存时长或下载材料都不会自动推进审核流程。
- 四类用户组：超管、数据管理员、活动管理员、正式用户。学校统一认证使用 SSO 授权码流程；公开问卷登记无需先登录。

## 当前实现

后端为 Go + Gin + GORM，前端为 React + TypeScript 管理端。已实现：

- 认证与账号：账号密码登录、学校 SSO、首次设密、手机号绑定、超管用户管理（含 CSV 导入）。
- 项目流程：项目台账、立项与变更审批、招募问卷及二维码、成员身份凭证、现场签到签退、整数小时登记/批量导入/补录、附件1 DOCX 版本、审核与审计历史。
- 角色分工：活动管理员负责本人项目基础信息、提交立项及现场出勤；数据管理员共享已提交项目，审批后承接招募、时长、材料及审核。业务数据均已持久化，签到不自动折算小时。
- 正式用户：招募活动、我的服务、个人信息。

尚未实现：地图选址、WPS 历史数据迁移、外部系统自动录入、附件3 生成。

更多设计见：[项目书](docs/project-proposal.md)、[认证与 SSO](docs/task-01-auth-and-sso.md)、[权限及施工设计](docs/task-02-project-workflow.md)、[成员导入与审批](docs/member-import-and-approvals.md)、[正式用户空间](docs/formal-user.md)；接口契约见 [`docs/openapi.yaml`](docs/openapi.yaml)。

## 快速开始

环境要求：Go 1.26.4+；Node.js 与 Yarn 1.22.22（前端）。开发默认 SQLite（纯 Go 驱动，无需额外安装）；生产必须使用 PostgreSQL。

```powershell
# 后端（仓库根目录）
go mod download
go run ./cmd/api
```

```powershell
# 前端（另开终端）
cd web
yarn install --frozen-lockfile
yarn dev
```

后端默认监听 `:8080`，SQLite 文件为 `data/volun-data.db`，首次连接自动创建并执行迁移。前端访问 `http://localhost:5173`，Vite 将 `/api` 与 SSO 回调代理到 `127.0.0.1:8080`。前端细节见 [`web/README.md`](web/README.md)。

开发模式（`APP_ENV=dev`）会初始化管理员 `admin`，默认密码 `change-me`，每次启动将其同步为 `DEV_ADMIN_PASSWORD`。该凭据仅限本地，部署时务必另设；生产和 test 模式不会创建或打印该账号。

健康检查：

| 路径 | 说明 |
| --- | --- |
| `/healthz` | 进程存活 |
| `/readyz` | 数据库连通，失败返回 503 |
| `/api/v1/ping` | 版本化 API 示例 |

## 配置

服务读取启动工作目录下的 `.env`，显式环境变量优先；请在仓库根目录启动。将 [`.env.example`](.env.example) 复制为 `.env` 后修改（该示例文件本身不会自动加载）。`.env` 须保存为 UTF-8；修改后重启后端。

| 类别 | 主要变量 |
| --- | --- |
| 运行 | `APP_ENV`、`LOG_LEVEL`、`HTTP_ADDR`、`FRONTEND_URL` |
| 数据库 | `DB_DRIVER`、`SQLITE_PATH`、`DATABASE_URL`、连接池与超时 |
| SSO | `SSO_CLIENT_ID`、`SSO_CLIENT_SECRET`、`SSO_REDIRECT_URI`、`SSO_SCOPES` |
| 附件1 | `ATTACHMENT1_TEAM`、`_CONTACT_*`、`_NOTES`、`_TRAINING` |

生产示例：

```powershell
$env:APP_ENV = 'prod'
$env:DB_DRIVER = 'postgres'
$env:DATABASE_URL = 'postgres://USER:PASSWORD@HOST:5432/volun_data?sslmode=verify-full'
go run ./cmd/api
```

生产环境不会回退到 SQLite，并应按环境配置 TLS、证书和可信代理。`FRONTEND_URL` 须为实际前端域名，不带查询串或路径；二维码也使用该地址，供手机扫码时须填手机可访问的地址（局域网 IP 或域名）。

### 学校 SSO

1. 为应用申请 `student_number` scope，并写入 `SSO_SCOPES`；否则平台可能不返回学号，用户 `id` 留空。
2. 平台登记的回调须与 `SSO_REDIRECT_URI` 完全一致。本地联调推荐 `http://localhost:5173/sso/callback`（经 Vite 代理交给 Go 后跳回前端）；若登记的是 `http://localhost:8080/auth/sso/callback`，回调后会落在后端端口，需手动回到 5173。不要混用 `localhost` 与 `127.0.0.1`。
3. 在启动后端的同一终端设置凭据：

```powershell
$env:SSO_CLIENT_ID = '<平台分配的 client_id>'
$env:SSO_CLIENT_SECRET = '<平台分配的 client_secret>'
$env:SSO_REDIRECT_URI = 'http://localhost:5173/sso/callback'
go run ./cmd/api
```

行为说明：

- 新 SSO 用户首次登录后须设置 12–72 字节的平台密码，设置前不能密码登录或访问受保护路由；已有账号不受影响。
- 用户以平台 `sub` 为主键，`id` 保存学号字符串（保留前导零），会话关联 `sub`。旧 SSO 账号不会按用户名自动认领新 `sub`，必要时人工核对。
- 未登录时 `/auth/me` 返回 401 属正常；SSO 发起正常返回 302，缺少配置时 303 到 `/login?sso=unavailable`。
- 设置 `LOG_LEVEL=debug` 可查看 SSO 各阶段诊断（授权端点、回调参数、state 校验、上游状态与耗时、跳转等），通过 `request_id` 关联；日志不输出 `client_secret`、code、state、nonce、令牌、Cookie 及响应正文。

### 手机号与批量导入

- 账号可绑定唯一的大陆 11 位手机号（兼容 `+86`、空格、连字符）：`PUT /api/v1/auth/phone`，body `{"phone":"..."}`，需登录及 `X-Requested-With: XMLHttpRequest`。管理员也可在账号目录维护。账号报名会自动读取姓名、学号和已绑定手机号。
- 创建用户支持可选 `phone`；CSV 导入表头为 `账号,姓名,学号,初始密码,用户组,手机号`，兼容旧五列格式。手机号重复会使整批失败，预览中显示原因。

### 附件1

附件1的打卡规则、招募范围、志愿者保障候选项和岗位取自立项资料。默认团队、联系人、补充说明与培训信息由 `ATTACHMENT1_*` 配置；联系人在编辑器中只读，保存与生成文档时统一采用环境值，说明和培训信息可在页面调整。

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

## 测试与检查

```powershell
go test ./...
go vet ./...
go build -o bin/api.exe ./cmd/api
go test -tags integration ./...   # 使用临时内存 SQLite 的集成测试
```

SQLite 检查不能替代 PostgreSQL 验证；迁移、生产 SQL 及事务行为需另行在 PostgreSQL 上验证。前端测试与构建见 [`web/README.md`](web/README.md)。

## 许可证

Apache License 2.0，详见 [`LICENSE`](LICENSE)。
