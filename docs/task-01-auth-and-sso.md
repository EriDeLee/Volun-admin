# 任务01：普通登录与 SSO 登录（前后端）

> 状态：待开发；拆解日期：2026-11-05。  
> 依据：《高校志愿服务项目管理平台项目书》及本次提供的统一认证接口说明。  
> 2026-11-06：已建立 Gin + GORM 基础工程及开发 SQLite 连接器；认证数据模型、普通登录、SSO 和前端仍待实现。运行方式见根目录 README。
> 2026-11-08：已实现登录与个人信息页。新建的 SSO 身份必须先设置本地密码；未完成前受保护路由与密码登录均被拒绝。公共用户 DTO 不返回内部 sub。

## 1. 任务目标与范围

交付一个可以运行的登录闭环：用户选择账号密码登录或学校统一认证，成功后进入最小工作台，刷新后保留登录状态，可以查看当前身份并退出。

“普通登录”暂按**预置本地账号 + 密码**拆解。原项目书仅明确学校 SSO，没有定义本地账号来源；实施前需确认是否保留本地登录及其适用人群。此处默认由运维命令创建账号，不提供公开注册。

| 本任务包含 | 后续任务处理 |
|---|---|
| 最小后端、前端、数据库迁移与运行配置 | 完整业务工程、Worker、对象存储 |
| 账号密码登录、学校 SSO 登录 | 注册、找回密码、用户管理页面 |
| 当前用户查询、本地会话、退出登录 | 账号主动绑定/解绑、跨系统单点登出 |
| 四个用户组标识及受保护页面入口 | 用户组分配界面、完整业务权限与项目数据范围 |
| 登录页、最小工作台、失败提示 | 项目台账、问卷、时长、材料及统计页面 |
| 认证接口契约、必要验证与部署说明 | 发信 API、消息记录、Gitea 接入 |

公开问卷后续仍允许未登录访问；本阶段路由设计应预留公开路由，不将所有页面统一强制跳转登录。

## 2. 实现基线

- 后端沿用项目书：Go、Gin、GORM、PostgreSQL、dev 模式下使用 sqlite；前端沿用 React、TypeScript、Vite、React Router、shadcn heroui等
- 两种登录方式共用本地用户、会话及退出逻辑。认证模块命名为 `auth`，避免与业务场次模块 `sessions` 混淆。
- 浏览器通过同源 `/api/v1` 访问后端；生产由 Nginx 提供 HTTPS，开发使用 Vite 代理。
- 本地会话使用随机不透明会话标识，浏览器通过 HttpOnly Cookie 持有；服务端持久化摘要、用户关联及有效期。生产 Cookie 设置 Secure、SameSite=Lax、Path=/，不设置宽泛 Domain。
- 首期建议会话绝对有效期为 8 小时，配置化；退出立即撤销当前会话。上游 `expires_in` 是上游令牌有效期，不直接作为本地会话时长。
- 登录成功重新生成会话标识；每次鉴权检查会话有效性和本地账号状态，禁用账号不能继续使用既有会话。
- 密码使用 Argon2id 等成熟密码哈希方案存储；密码、Cookie、授权码及令牌不写入日志。
- 认证前后均使用来源校验及服务端 CSRF 令牌保护需要防护的写请求；具体获取流程见接口清单。SSO GET 回调通过登录事务及 state 校验保护。
- SSO 首次成功登录创建“正式用户”；认证平台的 `role` 不映射为本系统管理权限。超管由运维命令明确初始化，不采用“首个登录用户自动成为超管”。
- 本地账号与 SSO 身份不按同名账号、邮箱或学号自动合并；已有用户需要关联 SSO 时留到后续明确绑定流程。

## 3. 学校 SSO 接入约定

### 3.1 上游配置

| 配置项 | 值或要求 |
|---|---|
| Issuer / 身份来源命名空间 | `https://flyingstu.buaa.edu.cn/asso` |
| 授权地址 | `https://flyingstu.buaa.edu.cn/asso/oauth/authorize.php` |
| Token 地址 | `https://flyingstu.buaa.edu.cn/asso/oauth/token.php` |
| 用户信息地址 | `https://flyingstu.buaa.edu.cn/asso/oauth/userinfo.php` |
| Token 验证地址 | `https://flyingstu.buaa.edu.cn/asso/oauth/introspect.php`，本阶段不作为每次本地请求的必调依赖 |
| 推荐 scope | `openid profile email student_number teacher_number role` |
| client_id / client_secret | 由平台申请，密钥仅服务端配置 |
| redirect_uri | 建议 `https://<应用域名>/api/v1/auth/sso/callback`，须与登记值完全一致 |
| 应用前提 | `approved` 且 `enabled = 1` |

本阶段使用授权码交换及 userinfo 建立本地身份，不使用 `id_token` 作为登录依据，不自行解码其中声明来授权。若后续改为以 ID Token 认证，需另行补齐签名、Issuer、Audience、有效期和 nonce 等完整 OIDC 校验。不能因响应含有 `id_token` 就宣称已实现完整 OIDC 客户端。

### 3.2 登录处理顺序

1. 用户点击“学校统一认证”，浏览器访问本系统 SSO 发起接口。
2. 后端生成随机 state，保存短期登录事务，关联当前浏览器的临时 HttpOnly Cookie；建议事务有效期 5 分钟、一次性使用。将校验后的站内返回路径一并保存在服务端。
3. 后端返回 302，跳转上游授权地址，参数包括 `response_type=code`、`client_id`、固定登记的 `redirect_uri`、`scope` 和 `state`；使用标准 URL 编码。
4. 上游直接回调后端。后端处理授权取消或失败参数，并检查 code、state、浏览器关联及事务有效期；事务原子消费，刷新不重复换取令牌。
5. 后端以表单 POST 换取 Token：`grant_type=authorization_code`、`code`、`redirect_uri`、`client_id`、`client_secret`。检查 HTTP 状态、响应结构和非空 `access_token`，设置请求超时。
6. 后端通过 `Authorization: Bearer <access_token>` GET 用户信息；检查 HTTP 状态及非空 `sub`，如返回 `client_id` 则核对与配置一致。
7. 以 `(issuer, sub)` 查找或创建本地用户及身份映射，数据库唯一约束保证同一身份只有一条绑定；检查本地账号是否启用。
8. 更新允许同步的基础资料，保留本地用户组，建立本地会话。上游令牌只用于本次获取资料，本阶段不持久化。
9. 后端 303 跳转到已校验的站内路径或默认工作台；浏览器不经前端页面接收 code 或上游 Token。失败时跳转干净的登录页，传递有限的错误标识，不透传上游原文。

上游回调 URL 天然包含 code 和 state，反向代理及应用访问日志须对该路径省略查询串；回调响应设置 `Cache-Control: no-store`、`Referrer-Policy: no-referrer`。页面和 API 不缓存认证响应。

## 4. 最小数据模型

以下为认证部分增补，不替换项目书中的业务实体。

| 实体 | 最小字段 | 约束与用途 |
|---|---|---|
| `users` | `id`、`name`、`status`、`created_at`、`updated_at` | 本地授权主体，status 为启用/禁用 |
| `user_groups` / `user_group_memberships` | 固定组代码、用户与组关联 | 沿用项目书关联模型，组代码固定为 `super_admin`、`data_admin`、`activity_admin`、`formal_user`；成员关联唯一 |
| `local_credentials` | `user_id`、`username`、`password_hash` | username 按明确的规范化规则唯一；无明文密码 |
| `external_identities` | `id`、`user_id`、`issuer`、`sub`、可选上游 username/email/学号/工号 | `(issuer, sub)` 唯一；sub 按字符串保存，不按学号绑定 |
| `auth_sessions` | `id`、`token_digest`、`user_id`、`auth_method`、`expires_at`、`revoked_at`、`created_at` | 摘要唯一；到期与撤销后不可用于鉴权 |
| `sso_login_transactions` | `id`、`state_digest`、`browser_digest`、`return_to`、`expires_at`、`consumed_at` | 一次性事务，state 及浏览器关联只存摘要；过期记录定期清理 |

认证前 CSRF 上下文可使用单独短期服务端记录；登录后绑定到当前会话。不要把 CSRF 令牌存储职责混进业务场次表。

数据库操作保留必要事务边界：首次 SSO 建用户、关联身份及默认组共同提交；身份映射冲突时读取既有绑定，不生成重复用户。不在上游网络请求期间持有数据库长事务。

## 5. 前后端接口契约

路径均相对于 `/api/v1`。JSON 遵循项目书的 `errcode`、`message`、`data`、`request_id` 及可选 `field_errors` 格式；302/303 为浏览器导航响应。

| 方法与路径 | 请求 | 返回及前端动作 |
|---|---|---|
| `POST /auth/setup-password` | SSO 建立的有效平台会话、JSON `{password}`；密码长度 12–72 字节 | 写入 bcrypt 密码并清除首次设置状态；成功后可继续使用平台 |
| `GET /auth/csrf` | 同源请求，可在未登录时访问 | 建立/复用短期认证上下文，返回 `csrf_token`；前端仅在内存持有 |
| `POST /auth/login` | JSON `{username, password}`，Cookie 及 `X-CSRF-Token` | 成功设本地会话 Cookie，返回当前用户；失败返回统一凭据提示 |
| `GET /auth/sso/start` | 可选 `return_to`，只接受允许的站内相对路径 | 建立登录事务，302 跳转上游 |
| `GET /auth/sso/callback` | 上游 code/state 或授权失败参数 | 后端完成认证及建会话，303 跳转站内页面 |
| `GET /auth/me` | 本地会话 Cookie | 返回当前用户；未登录或会话失效为 HTTP 401 / `200001` |
| `POST /auth/logout` | Cookie 及 `X-CSRF-Token` | 撤销当前会话并清 Cookie；重复退出可成功，不注销学校会话 |

登录前后的 CSRF 上下文会轮换；前端登录成功后重新获取 CSRF 令牌。`GET /auth/csrf` 及所有认证 JSON 响应设置 `Cache-Control: no-store`；来源策略只允许受信同源访问，不启用任意来源携带凭据。

`/auth/me` 与普通登录成功的 `data` 结构统一：

```json
{
  "user": {
    "id": "本地用户ID",
    "name": "用户姓名",
    "groups": ["formal_user"]
  },
  "auth_method": "sso"
}
```

`auth_method` 取 `password` 或 `sso`。身份展示确需账号时可补充最小展示字段；不默认返回上游完整资料、密码摘要、会话标识或 Token。禁用账号不返回可用会话。

新增认证错误码草案，实施时登记到统一错误码目录及 OpenAPI：

| ErrCode | 名称 | HTTP / 使用方式 |
|---|---|---|
| `200001` | AUTHENTICATION_REQUIRED | 401，沿用项目书 |
| `200002` | PERMISSION_DENIED | 403，沿用项目书 |
| `200003` | INVALID_CREDENTIALS | 401，账号或密码错误，不区分账号是否存在 |
| `200004` | ACCOUNT_DISABLED | 403，已确认身份但本地账号被禁用；密码登录界面仍统一提示凭据不可用 |
| `200005` | SSO_TRANSACTION_INVALID | 400，登录事务不可用，提示重新发起 |
| `200006` | SSO_AUTHORIZATION_FAILED | 400，授权未完成 |
| `200007` | SSO_PROVIDER_UNAVAILABLE | 502，上游请求失败或响应不能用于认证 |
| `200008` | CSRF_VALIDATION_FAILED | 403，请求校验未通过 |
| `100005` | RATE_LIMITED | 429，沿用项目书，用于认证请求限流 |

SSO 导航失败返回登录页的有限错误标识，由前端映射提示；其对应 ErrCode 用于统一登记和服务端诊断，不要求把回调变成 JSON 页面。

## 6. 可分配的开发子任务

| 编号 | 负责端 | 工作 | 明确交付物 | 依赖 |
|---|---|---|---|---|
| AUTH-01 | 前后端共同 | 确认普通登录口径、用户组代码、接口字段及部署域名 | 本文确认稿、认证 OpenAPI、配置样例 | 无 |
| AUTH-02 | 后端 | 初始化最小 API、配置加载、日志及统一错误响应 | 可启动服务、健康检查、敏感字段日志规则 | AUTH-01 |
| AUTH-03 | 后端 | 建立认证数据表、迁移及固定用户组 | GORM Model、版本化迁移、显式创建本地账号/初始超管的运维命令 | AUTH-02 |
| AUTH-04 | 后端 | 完成本地会话、鉴权上下文、CSRF 及退出 | `/auth/csrf`、`/auth/me`、`/auth/logout`、鉴权中间件 | AUTH-03 |
| AUTH-05 | 后端 | 完成账号密码登录、密码哈希校验及登录限流 | `/auth/login`、统一失败响应、登录成功会话轮换 | AUTH-04 |
| AUTH-06 | 后端 | 完成 SSO 发起、回调、用户资料读取及身份映射 | `/auth/sso/start`、`/auth/sso/callback`、上游客户端及超时处理 | AUTH-04 |
| AUTH-07 | 前端 | 初始化最小 React 工程、路由和 API 客户端 | 同源代理、错误码类型、公共/受保护路由划分 | AUTH-01，可依据契约先行 |
| AUTH-08 | 前端 | 实现白蓝登录页，两种登录入口及状态反馈 | `/login`，账号密码表单、SSO 按钮、加载/失败/重试提示 | AUTH-07 |
| AUTH-09 | 前端 | 实现当前用户恢复、最小工作台及退出 | `/` 工作台壳，当前用户与用户组展示，登录后缓存重置 | AUTH-08；联调依赖 AUTH-04～06 |
| AUTH-10 | 前后端共同 | 集成验证及学校测试应用联调 | 验证记录、运行说明、环境变量样例、已知限制清单 | AUTH-05、06、09 |

建议先完成接口契约，前端按契约推进页面；后端先交付账号密码登录闭环，再接学校 SSO。仅在本地会话建立后才显示登录成功，不能以回调收到 code 作为成功依据。

## 7. 前端交互要求

- 登录页展示平台名称、账号、密码、“登录”及“学校统一认证”；不提供尚未实现的注册或找回密码链接。
- 提交期间防止重复点击，失败保留账号并清空密码；密码不持久化到浏览器存储。
- SSO 使用浏览器整页导航，回调由后端处理，前端没有交换 Token 的代码。
- 应用启动先请求 `/auth/me`，确认状态后再显示受保护内容；页面刷新保持登录。
- HTTP 401 清理当前用户及相关查询缓存，转到登录页；HTTP 403 展示无权限提示，不循环跳转。
- 登录后恢复经校验的站内访问路径；密码登录和 SSO 登录都不能接受任意外部跳转地址。
- 退出成功后清理用户及用户相关缓存，返回登录页；网络失败展示可重试提示，不把服务端未完成的退出显示为成功。
- SSO 被取消、应用尚未可用或上游暂不可用时给出简明提示；重新登录应重新创建登录事务。
- 最小工作台只展示当前身份、四用户组中的实际所属组及退出按钮，暂不呈现可操作的项目业务入口。

## 8. 验收清单

以下验证使用自有测试账号、隔离数据库及明确标注的上游模拟响应；真实平台仅做正常授权流程联调。

- [ ] 空仓库按文档可启动前后端及数据库，完成迁移并通过运维命令创建测试账号。
- [ ] 正常账号密码登录成功，密码仅保存哈希；凭据不可用时给出统一提示。
- [ ] 新 SSO 身份在设置密码前不能使用账号密码登录或访问受保护路由；密码经 bcrypt 保存后恢复访问。
- [ ] 公开用户响应及前端不展示内部 sub；SSO 缺少公开用户名时不得将 sub 派生为页面展示账号。
- [ ] 登录后 `/auth/me` 返回本地用户及用户组；刷新页面保留登录。
- [ ] 会话生命周期及账号状态单元验证通过；退出后会话撤销，页面缓存清理。
- [ ] SSO 发起参数、redirect_uri 编码、登录事务有效期及状态校验的单元验证通过。
- [ ] 上游客户端在隔离模拟数据下正确处理正常响应、非成功状态、缺少必要字段及超时，均无半成品本地会话。
- [ ] 学校测试应用完成真实登录：收到回调、成功交换 Token、userinfo 有 sub、建立本地会话。
- [ ] 同一 `(issuer, sub)` 重复正常登录关联同一本地用户，首次默认为正式用户；既有用户组不会被上游资料覆盖。
- [ ] 本地账号和 SSO 身份不会因同名、同邮箱或相同学号自动合并。
- [ ] 前端代码、浏览器持久化存储、普通日志及工作台 URL 均无 client_secret 或上游 Token；回调访问日志省略查询串。
- [ ] 生产配置包含 HTTPS、会话 Cookie 属性、可信来源及 CSRF 处理，认证响应不缓存。
- [ ] 登录页在桌面及 375px 手机宽度正常使用，键盘操作、字段错误及加载提示清楚。
- [ ] 认证 OpenAPI、前端类型、错误码目录及实际响应一致；导航重定向有单独说明。

## 9. 联调输入与交付边界

实施前需确认普通登录的适用人群及账号创建方式；学校联调前需要平台提供已批准且启用的测试应用、client_id、服务端密钥和已登记回调地址。密钥通过受控配置渠道提供，不提交到仓库或前端环境变量。

环境变量样例至少覆盖：`DATABASE_URL`、`APP_BASE_URL`、`SESSION_TTL_SECONDS`、`SSO_CLIENT_ID`、`SSO_CLIENT_SECRET`、`SSO_REDIRECT_URI`、`SSO_SCOPES`；固定上游地址可集中配置并校验。生产缺少密钥时应启动失败或明确禁用 SSO，不假装配置可用。

在学校凭据尚未提供时，可以完成本地登录和隔离模拟联调；交付记录必须区分“本地功能通过”和“学校真实 SSO 联调通过”。本任务完成后，再拆项目台账、权限管理及后续业务任务。
