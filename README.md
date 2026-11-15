# 高校志愿服务项目管理平台

面向学校及学院志愿服务管理部门，将立项、招募、志愿者登记、服务时长、材料生成及审核归档集中管理。后端使用 Go + Gin + GORM，前端使用 React + TypeScript + Vite。

[快速开始](#快速开始) · [文档导航](docs/README.md) · [前端开发](web/README.md) · [接口契约](docs/openapi.yaml)

## 能做什么

- **项目管理**：项目台账与十二种业务状态、立项及变更审批、操作与审计历史。
- **招募与出勤**：手动或公开问卷登记、二维码、成员身份凭证、现场签到签退。
- **时长与材料**：整数小时登记、批量导入、补录与复核、附件1 DOCX 编辑生成及版本管理。
- **账号与个人空间**：账号密码及学校 SSO、首次设密、手机号绑定、账号 CSV 导入、招募活动与我的服务。

四类用户组为超管、数据管理员、活动管理员和正式用户。活动管理员负责本人项目基础资料、提交立项与现场出勤；数据管理员共享已提交项目，审批后承接招募、时长、材料和审核。公开问卷登记无需登录，服务器独立校验权限。

时长由管理员人工登记，签到不会自动产生小时；报名、保存时长或下载材料不会自动推进审核。**地图选址、WPS 历史数据迁移、外部系统自动录入、附件3 生成尚未实现。**

## 快速开始

需要 **Go 1.26.4+、Node.js 24 LTS、Yarn 1.22.22**。本地默认 SQLite，无需额外安装数据库；生产必须使用 PostgreSQL。

```sh
git clone https://github.com/EriDeLee/Volun-admin.git
cd Volun-admin
cp .env.example .env
go mod download
go run ./cmd/api
```

PowerShell 请用 `Copy-Item .env.example .env` 复制配置。另开终端运行前端：

```sh
cd Volun-admin/web
yarn install --frozen-lockfile
yarn dev
```

打开 <http://localhost:5173>。开发模式默认账号为 **`admin` / `change-me`**，仅供本地使用，可由 `DEV_ADMIN_USERNAME`、`DEV_ADMIN_PASSWORD` 覆盖。`test` 与 `prod` 模式不会创建开发账号。

后端默认 `:8080`，数据库文件为 `data/volun-data.db`，首次连接自动迁移。Vite 将 `/api` 和 `/auth/sso/callback` 代理到 Go。SSO 可稍后配置，不影响本地账号登录。详细步骤、检查命令与排错见[本地开发与检查](docs/development.md)。

## 开发与部署入口

| 任务 | 入口 |
| --- | --- |
| 配置 `.env`、数据库、SSO、二维码及附件1 | [配置与 SSO](docs/configuration.md) |
| 运行单元测试、类型检查、构建与浏览器检查 | [本地开发与检查](docs/development.md#提交前检查) |
| 修改界面、路由、主题与响应式布局 | [前端开发说明](web/README.md) |
| 了解权限、状态机和未实现规划 | [文档导航](docs/README.md) |

生产使用 `APP_ENV=prod`、`DB_DRIVER=postgres` 和 `DATABASE_URL`；服务不会回退到 SQLite。配置实际的 `FRONTEND_URL`，并为部署环境设置 TLS、证书与可信代理。静态资源构建和前端路由回退要求见[前端部署说明](web/README.md#部署)，数据库升级约定见[迁移说明](docs/development.md#数据库迁移)。

## 许可证

[Apache License 2.0](LICENSE)。
