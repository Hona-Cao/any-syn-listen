# 外部歌单镜像同步（开发中）

此分支提供一个**不写回来源**的实验性版本，优先保证 AnyListen 原有歌单安全。

## 已实现（需构建及实际登录验证）

- 在「设置 → WebDAV 同步」中开启「同步 LX N Music 歌单」，复用上方的 WebDAV 服务器和凭据；目录默认 `/LX_Music/`。读取 `playlists.json` 的 `data.defaultList`、`data.loveList`、`data.userList`。
- 读取结果以 `LX N ·` 开头的独立普通歌单保存；不覆盖 AnyListen 的「我喜欢」和「试听列表」，也不写回安卓端文件。
- 在同一设置页填写网易云 Cookie（包含 `MUSIC_U`），开启账号同步后读取网易云创建/收藏的歌单与每日推荐。网易云列表以 `网易云 ·` 开头，同样只读。
- 默认约每三分钟检查一次；开启后也可重启应用触发首次同步。外部列表标记 `meta.externalMirror`，仅更新同一来源的镜像。
- 不删除来源已不存在的镜像歌单，以防网络或鉴权故障造成意外删除；本地对镜像进行编辑可能在下一次同步时被覆盖。
- 不同步 Android 本地文件路径；它们在电脑上无法直接播放。
- 同步期间仍继续保留 AnyListen 自己的 WebDAV 快照协议，两者数据不会混写。

## 重要限制

1. 本次是 LX N → AnyListen 单向镜像；不是双向编辑、同步播放历史或同步下载任务。
2. 网易云使用逆向的 `weapi` 接口，可能过期或被限流，尚需真实账号、网络环境测试。
3. 网易云 Cookie 当前保存在 AnyListen **本机应用配置**，不会写入 LX N 的 `playlists.json` 或 AnyListen 歌单快照。不要把含 Cookie 的应用配置分享、提交到 Git 或复制给他人。面向多用户 Web 服务时还需要进一步隔离凭据。
4. 本分支尚未完成 CI、端到端或真实 WebDAV 服务回归测试，合并前应验证首次导入、重复导入、冲突、登录过期和多设备场景。

## QQ 音乐 / 酷狗音乐：待接入适配器

- QQ 音乐用户歌单可参考 [ylw1997/qqmusic-api](https://github.com/ylw1997/qqmusic-api) 的 `GetPlaylistByUin`、`CgiGetDiss` 逻辑。这里需要 musicid/musickey/uin 等已授权凭据，不能将公开歌单详情接口当作个人账号接口。
- 酷狗音乐可参考 [MakcRe/KuGouMusicApi](https://github.com/MakcRe/KuGouMusicApi)，包括 `/user/playlist`、`/playlist/track/all/new`。该 API 服务可能需要自行部署。
- 两端应统一转换成 `MirrorPlaylist`，由 `applyExternalMirrors` 写入独立用户列表。严禁把 Cookie、token 写进歌单元数据。
- QQ/酷狗尚未在本分支实现可用的账号登录和 API 适配器；需真实账号验证其认证和歌曲数据格式后再启用。

## 相关实现

- `packages/shared/app/modules/sync/external/lxConvert.ts`：LX N v2 文件格式解析 / 歌曲映射。
- `packages/shared/app/modules/sync/external/lxWebdav.ts`：只读 WebDAV 下载。
- `packages/shared/app/modules/sync/external/netease.ts`：网易云账号 / 每日推荐。
- `packages/shared/app/modules/sync/external/mirror.ts`：幂等镜像管理。


## 网易云登录与长效会话（实验性）

桌面版在设置页点击“打开网易云官方登录页面”，在独立、启用 sandbox 的窗口中通过官方页面使用手机或扫码登录。主进程读取该域名的 HttpOnly Cookie，验证账号后保存到系统安全存储加密的本机凭据文件；不注入 JavaScript，不触碰账号密码和短信验证码，也不把 Cookie 写入歌单快照或 Git。

Windows / macOS 依赖 Electron safeStorage 与 OS 钥匙串；Linux 若只提供不安全的 basic_text 后端，则不自动保存登录结果，需使用手动 Cookie 模式。手动 Cookie 仍保存在本机应用设置中（未额外加密），仅供可信环境使用。Web 服务仍保留手动模式。

网易云歌单同步：最多每 3 小时一次。登录刷新：最多每 18 小时尝试一次，失败后不高速重试；每次成功续期都合并服务器 Set-Cookie 并验证账户。某些登录方式（尤其二维码获得的会话）可能不支持自动刷新；服务器要求重新认证时，用户必须通过官方页面重新登录。无法保证永久有效。

### QQ、酷狗登录态的续期方向

| 平台 | 需要保留的凭据 | 参考刷新方式 |
| --- | --- | --- |
| 网易云音乐 | MUSIC_U、__csrf 等 Cookie | WEAPI login/token/refresh，验证后更新 Set-Cookie |
| QQ 音乐 | musicid、musickey、refresh_key、refresh_token、login_type 等 | music.login.LoginServer.Login（loginMode=2），按登录类型选择参数 |
| 酷狗音乐 | token、userid、appid、设备标识 | KuGouMusicApi 的 /login/token，同平台 token 才能刷新 |

QQ 的实现参考 https://github.com/l-1124/QQMusicApi/blob/main/qqmusic_api/modules/login.py ；酷狗参考 https://github.com/MakcRe/KuGouMusicApi/blob/main/docs/README.md 。

**QQ/酷狗目前是有源码依据的设计方向，不等于已完成账号适配、真实续期或实机验证。**平台仍可能因风控、账号安全、设备变化或撤销授权使刷新失败，不能靠绕过验证码实现永不过期。

### 轻量单元测试

PR 增加 Node 内置测试（只使用模拟 Cookie 和模拟 HTTP，没有私人账号数据），执行命令：

    node --experimental-strip-types --test tests/*.test.mjs

GitHub Actions 在开发分支执行这些小测试；尚未完成整仓 TypeScript 校验、安装包构建或真实账号测试，测试验证最后再做。
