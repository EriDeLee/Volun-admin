# 配置与 SSO

服务读取启动工作目录下的 `.env`，显式环境变量优先；请在仓库根目录启动。将 [`.env.example`](../.env.example) 复制为 `.env` 后修改（该示例文件本身不会自动加载）。`.env` 须保存为 UTF-8；修改后重启后端。

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

## 学校 SSO

1. 为应用申请 `student_number` scope，并写入 `SSO_SCOPES`；否则平台可能不返回学号，用户 `id` 留空。
2. 平台登记的回调须与 `SSO_REDIRECT_URI` 完全一致。本地联调推荐 `http://localhost:5173/auth/sso/callback`（经 Vite 代理交给 Go 后跳回前端）。后端直连回调 `http://localhost:8080/auth/sso/callback` 也受支持，完成后按 `FRONTEND_URL` 跳回前端；本地优先经 Vite 代理，保持浏览器同源。不要混用 `localhost` 与 `127.0.0.1`。
3. 在启动后端的同一终端设置凭据：

```powershell
$env:SSO_CLIENT_ID = '<平台分配的 client_id>'
$env:SSO_CLIENT_SECRET = '<平台分配的 client_secret>'
$env:SSO_REDIRECT_URI = 'http://localhost:5173/auth/sso/callback'
go run ./cmd/api
```

行为说明：

- 新 SSO 用户首次登录后须设置 12–72 字节的平台密码，设置前不能密码登录或访问受保护路由；已有账号不受影响。
- 用户以平台 `sub` 为主键，`id` 保存学号字符串（保留前导零），会话关联 `sub`。旧 SSO 账号不会按用户名自动认领新 `sub`，必要时人工核对。
- 未登录时 `/api/v1/auth/me` 返回 401 属正常；SSO 发起正常返回 302，缺少配置时 303 到 `/login?sso=unavailable`。
- 设置 `LOG_LEVEL=debug` 可查看 SSO 各阶段诊断（授权端点、回调参数、state 校验、上游状态与耗时、跳转等），通过 `request_id` 关联；日志不输出 `client_secret`、code、state、nonce、令牌、Cookie 及响应正文。

## 手机号与批量导入

- 账号可绑定唯一的大陆 11 位手机号（兼容 `+86`、空格、连字符）：`PUT /api/v1/auth/phone`，body `{"phone":"..."}`，需登录及 `X-Requested-With: XMLHttpRequest`。管理员也可在账号目录维护。账号报名会自动读取姓名、学号和已绑定手机号。
- 创建用户支持可选 `phone`；CSV 导入表头为 `账号,姓名,学号,初始密码,用户组,手机号`，兼容旧五列格式。手机号重复会使整批失败，预览中显示原因。

## 附件1

附件1的打卡规则、招募范围、志愿者保障候选项和岗位取自立项资料。默认团队、联系人、补充说明与培训信息由 `ATTACHMENT1_*` 配置；联系人在编辑器中只读，保存与生成文档时统一采用环境值，说明和培训信息可在页面调整。


## 本地管理员

`APP_ENV=dev` 时创建管理员，用户名默认 `admin`，密码默认 `change-me`。可通过 `DEV_ADMIN_USERNAME` 和 `DEV_ADMIN_PASSWORD` 覆盖；开发账号密码在每次启动时同步。`test`、`prod` 不创建该账号。

## 健康检查

| 路径 | 成功含义 |
| --- | --- |
| `/healthz` | 进程存活 |
| `/readyz` | 数据库可连接，失败返回 503 |
| `/api/v1/ping` | 版本化 API 可访问 |

返回[文档导航](README.md) · [本地开发与检查](development.md)
