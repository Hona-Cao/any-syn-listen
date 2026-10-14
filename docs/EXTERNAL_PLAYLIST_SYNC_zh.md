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
