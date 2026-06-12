# Yuedu 本地安装使用说明

这是一个保留源码的本地便携包。解压后可以直接运行，也可以继续修改源码。

## 运行要求

- Windows 10/11
- Node.js 18 或更新版本

## 启动

双击 `start-yuedu.bat`。

脚本会启动本地服务并打开：

```text
http://127.0.0.1:3456
```

## 停止

双击 `stop-yuedu.bat`。

## 如果依赖缺失

双击 `install-deps.bat`，或进入 `server` 目录执行：

```bash
npm install
```

## 源码目录

- `app/`：前端页面、样式和交互脚本
- `server/`：本地 Node.js 服务
- `sources/`：小说、漫画、听书、音乐、影视、游戏、工具源
- `scripts/`：源拆分、索引重建、审计和构建脚本

## 常见问题

- 如果提示 `EADDRINUSE: address already in use :::3456`，说明 3456 端口已有服务在运行。先双击 `stop-yuedu.bat`，再启动。
- 如果页面打不开，请确认启动窗口里没有报错，并确认浏览器访问的是 `http://127.0.0.1:3456`。
