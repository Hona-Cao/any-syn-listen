# 实现依据

- AnyListen 公共扩展 API：`packages/shared/extension-preload/src/types/api.d.ts`（`MusicList`、`Command`、`Storage`、`Request`）。https://github.com/any-listen/any-listen
- 官方扩展打包工具与 `.alix` 签名规范：https://github.com/any-listen/extension-kit
- 网易云验证码路径：https://github.com/nooblong/NeteaseCloudMusicApiBackup/blob/main/module/captcha_sent.js
- LX N WebDAV 数据结构：https://github.com/souvenp/lx-netease-music-mobile/blob/main/src/core/sync/webdavSync.ts
- 酷狗账号、歌单类别及每日推荐请求：https://github.com/MakcRe/KuGouMusicApi （`module/user_playlist.js`、`module/playlist_track_all_new.js`、`module/everyday_recommend.js`、`module/login_cellphone.js`）。没有复用模拟验证码/风控绕过逻辑。
- QQ 歌单及个性推荐：https://github.com/l-1124/QQMusicApi （`modules/user.py`、`modules/recommend.py`），以及 https://github.com/ylw1997/qqmusic-api

本目录复用了本 Fork 前期已提交的平台读取与 LX 字段转换代码，保留上游 LICENSE。Electron 的运行时发布目录同时保留 Electron 的 LICENSE 和 LICENSES.chromium.html。扩展构建工具按其 Apache-2.0 许可使用。
