# AnySynListen 原生账号登录（测试版）

这属于 AnySynListen 主程序改动，并非可以安装在官方 AnyListen 里的独立 .alix 扩展。
官方插件无法读取外部 Chrome 的 HttpOnly Cookie。

在 AnySynListen 的 设置 → 软件设置 → 数据同步 → 音乐平台账号 中登录：

- 网易云：在软件内打开网易云官网，手机验证后 Electron 主进程自动读取 MUSIC_U Cookie，再从同一浏览器会话查询账号 ID。确认有效才加密保存，并显示“登录成功”。
- QQ 音乐：软件内打开官网，QQ/微信 SSO 弹窗使用相同的 Electron 会话。获得 musicid、qqmusic_key 并经平台验证后才算登录。
- 酷狗：目前采用手机酷狗 App 扫码授权专用窗口，不使用不稳定的短信验证码登录接口。

浏览器启用 sandbox、contextIsolation 和 webSecurity，关闭 NodeIntegration，仅允许官方认证 HTTPS 域名。登录状态用 Electron safeStorage 安全加密保存。
内置浏览器与外部 Chrome 相互隔离，因此需要首次在内置窗口重新登录；后续可复用本机持久化会话。
登录成功与歌单同步成功分别显示，避免账号已登录但歌单网络请求失败时错误提示“登录失败”。

构建产物的应用名 any-syn-listen，用户数据目录 AnySynListenDatas，URI 协议 anysynlisten://。
它们均不同于官方 AnyListen，避免覆盖原有软件和数据。
Windows 构建由 GitHub Actions Windows runner 负责，不需 Codex。

测试：node --test packages/desktop/test/nativeAccountLogin.test.mjs
桌面编译：pnpm -F @shared/scripts build:desktop

目前已通过 Chromium 会话域名、Cookie 处理、账号身份判断等本地自动测试与主程序打包。
实际三方账号验证与私人歌单读取需要登录后进一步实测，不保证全部平台均有效。
