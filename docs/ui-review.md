# 滚动与通用组件检查

本轮保留现有管理端布局与业务权限，按 Modern Web Guidance 检索的指南检查滚动条、原生弹窗、项目标签页、表单及通用控件。下列结论来自源码、现有测试和模拟 API 浏览器验证，不代表完整的 WCAG 认证。

## 采用的指南

使用 `modern-web-guidance@latest` 检索并读取：

- `customize-scrollbar-color-and-thickness`、`adapt-scrollbar-to-contrast-preferences`、`browser-ui-theming`。
- `dialog`、`prevent-page-scroll-under-modal-dialog`、`navigation-drawer`。
- `tabs`、`forms`、`accessibility`、`brand-consistent-forms`。

项目：[GoogleChrome/modern-web-guidance](https://github.com/GoogleChrome/modern-web-guidance)。指导原则是优先使用浏览器原生能力；仅在有明确需求时补充兼容处理。

## 发现与处理

| 优先级 | 位置与问题 | 用户影响 | 本轮处理 |
| --- | --- | --- | --- |
| P2 | 页面、侧栏、表格及导入预览使用默认滚动条 | 浅深主题样式不一致，窄表格缺少清楚的键盘滚动入口 | 统一主题变量及原生滚动条颜色、细度；宽表格复用有名称、可聚焦的 `ScrollRegion` |
| P2 | 移动导航手工循环 Tab，并修改 body 的 overflow | 无法正常进入浏览器工具栏，可能影响页面滚动位置与布局 | 统一 `showModal()` 生命周期，保留原生焦点与关闭事件，移除手写焦点循环和根滚动锁定 |
| P2 | 普通弹窗与预览没有统一的滚动隔离和关闭清理 | 背景可能随滚动手势移动，长表单关闭入口会离开视口 | 使用 `dialog:modal` 及 `::backdrop` 的滚动隔离；标题和关闭按钮固定在弹窗顶部；卸载时关闭原生对话框 |
| P1 | 项目功能只有 `tab` 按钮，没有完整的 `tablist`/`tabpanel` 和键盘模式 | 辅助技术无法识别完整关系，键盘用户需要逐个 Tab | 补齐语义及名称，提供方向键、Home/End；Enter/空格确认选择，避免方向键切换长表单；选中下划线不改变标签尺寸 |
| P1 | 工作流页面在已有 main 内又嵌套 main | 主内容地标重复 | 保留外壳的唯一 main |
| P1 | 部分小字、成功状态与输入边框对比不足 | 浅色或暗色背景下文字、输入框和焦点不易辨认 | 调整语义颜色、控件边框及焦点；修正扫描发现的暗色登录页页脚对比度问题 |
| P1 | 密码字节长度、手机号错误没有完整关联至输入框 | 聚焦字段时无法直接得知错误及修正方式 | 关联说明和错误，标记 `aria-invalid`，校验失败聚焦字段，编辑时清除旧错误；账号字段关闭自动大小写和拼写更正 |
| P2 | 查询志愿者账号时仍可编辑关键词，旧请求可能晚到 | 新关键词下可能出现旧账号并被误选 | 丢弃过期响应，区分未查询、查询中、无匹配和有结果状态 |
| P2 | 触屏按钮、分页及输入字号偏小 | 点击不便，iOS 聚焦小字号字段可能自动放大 | 触屏常用按钮至少 48px，文本输入至少 1rem；保留桌面信息密度 |

保留已有的原生 select、checkbox、密码自动填充、减少动态效果偏好及隔离的 Word 预览 iframe，不引入自绘滚动控件或运行时组件库。

## 兼容与退化

- 优先使用 `scrollbar-color` 和 `scrollbar-width`。旧 WebKit 回退仅放在 `@supports not (scrollbar-color: auto)` 内，避免两套规则冲突。滚动条颜色不参与过渡动画。
- 细滚动条仅用于鼠标/触控板设备；页面保留键盘滚动，宽表格提供可聚焦滚动区域，未隐藏滚动条。触屏保留系统原生样式。
- 滚动条滑块与实际浅深背景保持至少 3:1 对比。更高对比度偏好恢复常规宽度；强制颜色模式交给系统，并为当前导航保留可见轮廓。
- 使用原生对话框关闭策略。移动导航优先采用 `closedby="any"`；不支持该属性时，只有按下和释放均在抽屉外才关闭，避免拖动选择文字时误关。
- 非溢出滚动容器的滚动隔离属于渐进增强。在尚未完整支持的浏览器中，原生 modal 仍阻止背景交互，溢出弹窗仍可独立滚动；不以改写 html/body overflow 作为回退。
- 标签页继续使用跨浏览器的 ARIA 与键盘模式；本轮未为仅部分浏览器支持的 `focusgroup` 增加 polyfill。

## 验证

- 78 项 Vitest 测试，涵盖嵌套弹窗名称、根滚动样式不被改写、账号查询乱序以及输入错误关联与焦点。
- `yarn build`（含严格类型检查）、`yarn format:check`、`git diff --check`。
- `yarn test:browser` 在 Chromium 中检查台账操作、原生弹窗、背景滚动隔离、长预览的键盘滚动、标签页键盘操作、手机号错误、触屏尺寸、高对比度与强制颜色模式。
- axe-core 扫描 12 个页面/状态：成员目录、添加成员弹窗、导入预览、工作流浅/深主题、个人资料字段错误、招募页、报名页、触屏台账、移动导航、320px 台账及登录页。结果写入被忽略的 `web/browser-check/component-accessibility.json`。

模拟检查不能替代真实学校 SSO、PostgreSQL、文件生成、Safari/Firefox 实机、屏幕阅读器和实际辅助设备测试。在线测试版继续使用单独的演示接口。

返回[文档导航](README.md) · [前端维护说明](../web/README.md)
