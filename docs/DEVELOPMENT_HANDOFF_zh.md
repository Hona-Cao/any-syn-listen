# AnySynListen 开发交接（2026-10-15）

> 给新对话或接手开发者：这是当前阶段的进度快照，请先读本文件，优先推进主程序内置账号登录，而不是重新做此前反复失败的独立插件。用户不熟悉源码，关注实机是否可用；应尽量自行编码、构建和测试，尽可能节省用户 Codex 额度。

## 仓库、分支、PR

- GitHub 仓库：https://github.com/Hona-Cao/any-syn-listen
- **当前优先开发分支：feat/native-account-browser**
- **内置浏览器主程序 PR（Draft）：https://github.com/Hona-Cao/any-syn-listen/pull/4**
- PR #4 当前基于 feat/native-account-extension，**并非 main**。后续若要合并到 main，先核查依赖分支、处理 PR 基线，不要直接合并尚未验证的登录功能。
- 旧插件 PR（Draft）：https://github.com/Hona-Cao/any-syn-listen/pull/3，仅供参考旧版 WebDAV 与歌单转换实现，目前不优先。
- 本机源代码工作区：D:/APP/MCP/Python/work/anylisten-plugin-work/host
- 主程序内置浏览器首个可用提交：57315ddf533b826b338b0baa275d352ce085746e。

## 用户最终目标

1. LX N Music/落雪 N Music 的 WebDAV 歌单与 AnySynListen 兼容，不能意外覆盖、删除历史歌单。
2. 网易云、QQ 音乐、酷狗音乐账号一键登录并自动得到授权会话；同步账号私人歌单、我喜欢、每日推荐，歌单加上清晰平台前缀。
3. 登录体验为：点击登录，在程序内部平台网页/官方扫码界面完成验证，软件自动判断登录成功和保存凭据。**绝不要求用户打开 Chrome 开发者工具手工寻找 Cookie。**
4. UI 使用 AnyListen 原生设置页风格与组件，避免独立 GUI 的视觉割裂。
5. 后续需要 Ctrl/Shift 批量选择歌单，支持归档、删除、确认和撤销。
6. 节省 Codex 额度；优先使用直接文件编辑、GitHub、Python_MCP 和 GitHub Actions。

## 旧版插件为何不作为优先方向

旧 .alix 账号歌单同步插件（v0.3.2–v0.3.4）遇到网易云外部 Chrome 登录成功但插件拿不到凭据、QQ 微信扫码状态卡住、酷狗短信接口返回 20006 等问题。插件无法直接读取用户 Chrome 内的 HttpOnly Cookie；反复调整二维码状态码也无法真正打通外部浏览器与 AnyListen 的登录状态。

**已决定将账号网页登录迁移到 AnySynListen 桌面主程序的 Electron BrowserWindow**。Cookie 从专用 Electron 会话读取，账号验证后交给现有平台同步模块。旧插件可保留做补充，不要再把其扫码轮询作为主入口。

## 已提交的代码

- packages/desktop/src/modules/accountLoginPolicy.ts：为网易云与 QQ 登录创建隔离 Chromium 分区；限制官方 HTTPS 登录/SSO 域名；纯函数校验账号信息、解析与过滤 Cookie。
- packages/desktop/src/modules/neteaseLogin.ts：内置网易云官方登录网页，在 persist:netease-auth 中读取包含 HttpOnly 的 MUSIC_U；以同一个 Electron Session.fetch 访问 https://music.163.com/api/nuser/account/get 确认账号 ID，然后调用 safeStorage 保存凭据。
- packages/desktop/src/modules/qqMusicLogin.ts：QQ 官网及微信/QQ 弹窗共享 persist:qqmusic-auth，凭 musicid、qqmusic_key 和 QQ 账号接口验证登录；登录验证和歌单下载分开，避免“歌单请求失败”误判“登录失败”。
- packages/desktop/src/app/index.ts：登录 OAuth 子窗口在同一浏览器会话运行，不再交给外部 Chrome；跳转限制域名；生产协议改为 anysynlisten://，避免抢占官方 AnyListen 的 anylisten://。
- packages/desktop/src/modules/accountVault.ts：之前已有 Electron safeStorage 安全加密，不把 Cookie 写入普通设置、日志或 WebDAV。
- packages/desktop/src/modules/kugouLogin.ts：沿用已有酷狗 App 二维码授权窗口；目前**不代表酷狗已完成内嵌网页登录 Cookie 自动抓取**。
- packages/view-main/src/views/Setting/AppSetting/DataSyncWebdav.svelte：在“软件设置 → 数据同步”增加“音乐平台账号”三个简洁登录按钮和状态，保留原有 WebDAV。
- packages/shared/app/modules/sync/external/：网易云、QQ、酷狗与 LX WebDAV 歌单同步逻辑已有实现；本阶段重点是登录与授权链路，不代表所有歌单和日推接口已实机通过。
- packages/desktop/test/nativeAccountLogin.test.mjs：安全域名、Cookie 过滤、账号判断等单元测试。
- docs/native-account-browser.md：主程序登录方案简述。
- .github/workflows/native-account-browser-windows.yml：独立的 Windows 便携版构建流水线。

**认证结果三层独立：已打开网页不等于账号已登录；账号验证通过不等于歌单同步完成。** 后续应显示更准确的各阶段状态和错误，不要再只出现“等待扫码”。

## 2026-10-15 已做的验证

- 本地测试：node --test packages/desktop/test/nativeAccountLogin.test.mjs，4 项通过。
- 用户 Windows 电脑：corepack pnpm -F @shared/scripts build:desktop 成功，构建完整 Electron 主程序、preload、主界面、扩展运行时。
- GitHub Actions 的 Windows runner 完成原生依赖安装、专项测试、Electron 全量编译、Windows 便携版打包和工件上传：
  https://github.com/Hona-Cao/any-syn-listen/actions/runs/38672425777
- 构建产物名：any-syn-listen-integrated-login-windows-x64，约 97 MB，Actions 附件在 **2026-10-29 UTC** 过期（不是永久 Release）。
- 已自动下载到用户 Windows 电脑，路径：
  D:/APP/AnySynListen-NativeLogin-Test/any-syn-listen-0.10.0-beta.2-x64-portable.exe
- 本地文件存在，是 Windows PE EXE，大小 101810652 字节，SHA256：
  4f36e3b3fe15bb1f6dc09a9aceeb980c12fcf1837380e0ad6c7c7cc84abb961b
- **尚未完成 Windows 原生程序启动、网易云/QQ/酷狗真实账号登录和完整私人歌单同步的端到端验证**。CI 通过只证明构建和模拟测试通过。
- Windows 用户电脑缺 Visual Studio C++ 工具；正常 pnpm install 的 better-sqlite3 原生编译会失败。可用 pnpm install --frozen-lockfile --ignore-scripts 做本地前端编译；完整 Windows 原生打包交给 GitHub Actions，**不要让用户自行安装大型 C++ 开发环境**。
- 部分跨包 TypeScript 和 svelte-check 检查仍有其它目录报错，不能声称整个仓库静态检查 0 错误。

## 数据与安全约束

- Fork 的软件名称是 any-syn-listen、数据目录是 AnySynListenDatas、URI 是 anysynlisten://，均独立于官方 AnyListen 和 AnyListenDatas。**不要覆盖官方播放器或用户数据目录。**
- 内置网页登录禁用 NodeIntegration，启用 sandbox、contextIsolation、webSecurity，限制只能导航官方 HTTPS 认证域名；OAuth 子窗口共享分区。
- 不读取外部 Chrome Profile，不窃取整个浏览器的 Cookie，不把 Cookie、短信验证码、WebDAV 密码提交到仓库或日志。
- 凭据只通过 Electron 系统安全存储保存；扫码页面的“已确认”必须经过真正的账号服务校验。
- WebDAV/LX 镜像不能在远端 API 失败时删除已经导入的歌单。批量删除或归档必须由用户明确选择和确认。

## 下一轮开发优先级

1. **先真正运行上述本地 Windows 测试 EXE**，验证 UI 中的“音乐平台账号”三行按钮、点击后是否在程序内部打开平台窗口。不要先重新修改 .alix 插件。
2. 网易云：手机号验证或官方扫码后检查 Chromium 分区是否接收到 MUSIC_U，session.fetch 对网易云 account/get 是否返回 ID、窗口是否自动关闭并在主界面显示“登录成功”。不要输出真实 Cookie。
3. QQ：微信扫码 SSO 子窗口是否在同一 Electron 分区；手机确认后是否获得有效凭据、通过 QQ 音乐 API 验证和显示状态。
4. 酷狗：测试内置酷狗 App 扫码窗口能否在手机确认后返回 token；与“验证码 20006”失败的旧流程分开诊断。
5. 账号有效后，继续实测及修复私人歌单、我喜欢、每日推荐导入和周期刷新。分开显示“账号登录成功”和“歌单同步成功/失败”。
6. 账号稳定后再推进 Ctrl/Shift 批量选择歌单、归档和删除。
7. 等真实账号端到端验证再把 Draft PR #4 纳入稳定分支，不要未经用户验证就合并主分支。

## 下一轮对话建议直接输入

“请继续开发我的 Hona-Cao/any-syn-listen。先读 GitHub 的 docs/DEVELOPMENT_HANDOFF_zh.md 和 Draft PR #4，基于 feat/native-account-browser 开发。优先在我 Windows 本地测试 D:/APP/AnySynListen-NativeLogin-Test/any-syn-listen-0.10.0-beta.2-x64-portable.exe 的内置登录窗口，解决网易云/QQ/酷狗登录状态自动获取和真实歌单同步。不要回到旧 .alix 插件，不要浪费 Codex 额度，不要覆盖官方 AnyListen 的歌单和数据。请直接推进代码和测试。”

如果新的对话暂时连不上 Windows 电脑，优先从 GitHub 分支、PR #4 和 Windows Actions 工件恢复；GitHub 版本是可信的交接记录。
