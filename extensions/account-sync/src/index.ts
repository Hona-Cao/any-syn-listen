import { NativeController } from './native-controller.mjs'
const api = require('any-listen')
const controller = new NativeController(api)
void controller.start().catch((error: Error) => api.logcat.error('账号同步扩展初始化失败：' + String(error.message).slice(0,180)))
