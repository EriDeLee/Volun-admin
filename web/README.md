# 志愿服务平台前端

建议使用 Node.js 24 LTS。React + TypeScript（组件与测试用 `.tsx`，接口、类型与配置用 `.ts`），Vite 构建。统一使用 Yarn 1.22.22，依赖由 `yarn.lock` 锁定，不维护 npm 锁文件。`yarn typecheck` 对源码、测试和 Vite 配置启用严格检查，`yarn build` 会先执行它。

界面沿用已确认设计：操作蓝 #2457d6、白色工作区、226px 侧栏、76px 顶栏，支持浅色/深色主题；760px 及以下使用原生对话框抽屉导航，项目台账切换为紧凑列表，其余宽表格在容器内滚动；使用本地中文字体与内嵌 SVG。

## 启动

先在仓库根目录运行 `go run ./cmd/api`，再：

```powershell
cd web
yarn install --frozen-lockfile
yarn dev
```

访问 `http://localhost:5173`。Vite 将同源 `/api` 和 SSO 回调代理到 `127.0.0.1:8080`，修改代理配置后需重启。SSO 域名、回调与 `FRONTEND_URL` 见[根目录 README](../README.md)，不要混用 `localhost` 与 `127.0.0.1`。

## 页面与路由

| 路由 | 页面 | 可见角色 |
| --- | --- | --- |
| `/login`、`/set-password` | 登录（账号密码/学校统一认证）、SSO 新账号强制设密 | 未登录/新账号 |
| `/profile` | 个人信息、手机号绑定、主题、退出 | 所有登录用户 |
| `/recruitment`、`/my-services` | 招募活动、我的服务 | 正式用户 |
| `/signup?project=ID` | 项目公开报名、问卷与签到入口 | 允许匿名 |
| `/activity` | 工作台：统计、待跟进、近期项目、新建立项 | 管理员 |
| `/projects`、`/projects/:id` | 项目台账（搜索、十二状态/部门筛选、分页）与项目工作流（立项、招募问卷与二维码、成员、附件1、现场出勤、时长、操作记录） | 管理员 |
| `/approvals` | 项目与变更审批 | 数据管理员、超管 |
| `/hours`、`/materials` | 时长管理、项目材料（附件1） | 管理员 |
| `/users` | 账号目录、创建与 CSV 导入 | 超管 |

管理路由先验证服务器会话，恢复身份后保留深链接和查询参数。接口契约见 [OpenAPI](../docs/openapi.yaml)，权限与流程见 [权限及施工设计](../docs/task-02-project-workflow.md)，服务端始终独立校验角色与数据范围。

## 业务约定

- 报名、签到、保存时长或下载材料不推进项目状态；出勤不自动产生时长。
- 时长为整数小时，空值（未登记）不等于 0；补录、更正需填写理由。写入提交 `X-Workflow-Version`，版本冲突时刷新后重试，不静默覆盖。
- 人员编号按文本处理，保留前导零。CSV 导出与材料内容做公式前缀及 HTML 转义。
- 未满足开放条件的子页面只显示原因说明（如立项未通过、最早场次未结束）。
- 认定时长仅在审核结果公布后展示，未公布为 `null`；活动管理员不能最终通过或驳回时长认定。
- 附件3 仅为占位，暂不提供生成与下载。

## 认证

启动时请求 `/auth/me`：401 转登录，网络或服务故障提供重试。学校统一认证通过整页导航完成；`password_setup_required` 强制进入设密页（12–72 字节），之后才能访问管理功能。密码、令牌与身份不写入浏览器持久化存储（仅主题偏好存于 localStorage）。退出在服务器确认成功后才清空本地身份，失败时保留页面以便重试。没有公开注册或找回密码。

## 校验

```powershell
yarn test           # Vitest（jsdom）
yarn typecheck
yarn format:check
yarn build          # 产物位于 dist/
```

### 浏览器检查

```sh
yarn test:browser
```

`check-workspace.cjs` 自动启动 `127.0.0.1:4175` 的 Vite，退出时关闭服务；模拟 API 覆盖台账搜索、筛选恢复、选择、加载和错误重试，以及导航焦点、响应式布局和浅深主题。截图保存在 `web/browser-check/`（已忽略），模拟数据只用于验证。

共享 `browser-options.cjs` 优先使用 `BROWSER_EXECUTABLE_PATH` 指定的浏览器，其次使用 `BROWSER_CHANNEL`（如 `chrome`、`msedge`），否则查找常见系统 Chrome/Chromium/Edge 与 Playwright Chromium。不再依赖写死的 Windows 路径。

如果没有浏览器，可运行 `yarn exec playwright-core install chromium`。也可指定现有安装：

```sh
BROWSER_EXECUTABLE_PATH=/usr/bin/chromium yarn test:browser
# 使用已启动的前端；设置 BASE_URL 后不自动启动服务
BASE_URL=http://localhost:5173 yarn test:browser
```

PowerShell 使用 `$env:BROWSER_EXECUTABLE_PATH = 'C:\Program Files\Google\Chrome\Application\chrome.exe'`，再运行命令。

已有场景脚本 `verify-members-ui.cjs`、`verify-recruitment-ui.cjs`（支持 `--dark`）、`verify-theme-ui.cjs`、`verify-volunteer-ui.cjs` 使用相同浏览器配置，但需要先启动 Vite，再用 `node <脚本>` 执行；默认地址 `http://127.0.0.1:5173`，可用 `BASE_URL` 覆盖，截图写入系统临时目录。这些检查不替代真实学校 SSO 和 PostgreSQL 联调。

## 界面维护

- 管理页、工作台和个人信息共用 `components/WorkspaceShell.tsx`，由 `Sidebar.tsx` 按角色提供导航；顶部提供“跳到主要内容”。新增页面复用外壳，避免导航与主题行为分叉。
- 移动导航使用原生 `<dialog>`：打开后锁定背景滚动，焦点留在抽屉内，支持关闭按钮、Escape、点击遮罩和选择页面后关闭；关闭后恢复触发按钮焦点。
- 在 `theme.css` 中维护语义颜色变量，页面通过变量支持浅深主题。操作蓝用于当前导航、关键操作和交互反馈；状态同时显示文字，不只依赖颜色。
- 760px 及以下的项目台账显示列表，保留批量选择和详情、成员、时长、材料入口；桌面保留完整表格，部分选择时全选框显示半选状态。新请求清空旧选择，避免导出旧筛选结果。
- 数据加载期间不显示虚假的零结果，首次加载用静态骨架；筛选无匹配提供清除入口，错误提供重试。长项目名称、部门与人员编号允许换行，保留编号前导零。
- 使用共享 `Modal`、`Badge` 和 `Icon`；表单有可访问名称，错误用 `role="alert"`，进度与成功消息用 `role="status"`。验证键盘操作、320px 手机、平板、桌面和两种主题。
- 保留减少动态效果偏好，不添加装饰性加载动画；不把权限判断或模拟数据当作服务端授权。

## 部署

将 `login`、`set-password`、`profile`、`activity`、`projects`、`approvals`、`hours`、`materials`、`users`、`recruitment`、`my-services`、`signup` 等前端路由回退到 `index.html`；`/api`、SSO 发起 `/api/v1/auth/sso/start` 及回调 `/auth/sso/callback` 交给 Go 服务。
