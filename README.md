# volun-data

志愿服务平台后端基础工程：Go + Gin + GORM。开发默认使用纯 Go SQLite 驱动，无需安装 SQLite 服务或 C 编译器；生产使用 PostgreSQL。

## 本地启动

需要 Go 1.26.4 或更新版本。在仓库根目录运行：

```powershell
go mod download
go run ./cmd/api
```

默认监听 `:8080`，自动创建 `data/volun-data.db`。相对路径以进程工作目录为准，数据库文件已忽略提交；启动只连接数据库，不自动建业务表。

```powershell
Invoke-RestMethod http://localhost:8080/healthz
Invoke-RestMethod http://localhost:8080/readyz
Invoke-RestMethod http://localhost:8080/api/v1/ping
```

- `/healthz`：进程存活检查。
- `/readyz`：真实数据库 Ping，失败返回 HTTP 503。
- `/api/v1/ping`：版本化 API 示例。

所有 JSON 返回 `errcode`、`message`、`data`、`request_id`；请求 ID 同时位于 `X-Request-ID`。未找到路由、方法错误及 panic 使用统一响应。结构化访问日志不包含查询串、请求体和数据库连接串。

## 配置

配置来自环境变量，`.env.example` 仅供参考，**不会自动加载 `.env`**。例如：

```powershell
$env:APP_ENV = 'dev'
$env:DB_DRIVER = 'sqlite'
$env:SQLITE_PATH = 'data/local.db'
$env:HTTP_ADDR = ':8080'
go run ./cmd/api
```

SQLite 连接器自动创建父目录，每个连接启用外键与 5 秒繁忙等待，固定单连接以减少本地并发写冲突；支持 `SQLITE_PATH=:memory:` 临时数据库。SQLITE_PATH 接受普通路径，不接受带查询参数的 URI。

生产必须配置 PostgreSQL，禁止回退 SQLite：

```powershell
$env:APP_ENV = 'prod'
$env:DB_DRIVER = 'postgres'
$env:DATABASE_URL = 'postgres://USER:CHANGE_ME@HOST:5432/volun_data?sslmode=verify-full'
go run ./cmd/api
```

生产 TLS 与证书按部署环境配置。连接池及超时配置见 `.env.example`。启动时验证数据库连接；Ctrl+C 优雅关闭 HTTP 服务并释放数据库连接。不默认信任代理转发头，反向代理部署时按实际网络配置可信代理。

## 目录

```text
cmd/api/              服务入口、启动与退出
internal/config/      环境配置及校验
internal/database/    GORM + SQLite/PostgreSQL 连接器
internal/httpapi/     路由、中间件及统一响应
docs/                 项目需求与认证任务拆解
```

业务代码后续按模块添加 handler、service、repository、model；数据库变更使用显式版本化迁移，生产不在启动时调用 AutoMigrate。当前未实现用户表、登录或 SSO。

## 检查

```powershell
go test ./...
go vet ./...
go build -o bin/api.exe ./cmd/api
```

本地 SQLite 验证不替代 PostgreSQL 集成验证；生产特有索引、SQL 和事务行为应在后续迁移及业务开发中单独验证。
