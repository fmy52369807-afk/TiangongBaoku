# 天工宝库 · TiangongBaoku

一个基于 Legado 书源格式的本地内容聚合应用，支持小说、漫画、听书、音乐、影视、游戏及其他特殊内容源。

项目采用原生 HTML/CSS/JavaScript 前端、Node.js + Express 后端、SQLite 数据库，并提供 Tauri Windows 桌面版支持。

## 功能特性

- 跨源搜索与分类浏览
- 小说在线阅读，支持滑动式与翻页式阅读
- 漫画图片阅读与单双页自适应
- 听书、音乐播放和本地播放列表
- HTML5 Video 与 HLS 影视播放
- 用户注册、登录与 JWT 身份认证
- 收藏和阅读历史
- 浅色、深色主题及响应式布局
- Legado 书源规则解析
- JSONPath、CSS 选择器及 `@js:` 规则支持
- Windows Tauri 桌面版及本地便携启动脚本

## 内容源

当前仓库包含 393 个内容源，其中 372 个处于启用状态：

| 分类 | 总数 | 启用数 |
| --- | ---: | ---: |
| 小说 | 271 | 269 |
| 漫画 | 50 | 44 |
| 听书 | 17 | 14 |
| 音乐 | 7 | 7 |
| 影视 | 17 | 7 |
| 游戏 | 3 | 3 |
| 特殊工具 | 28 | 28 |

内容源来自互联网公开的 Legado 书源配置。源站可用性会随时间变化，部分源可能失效、限流或需要登录。

## 技术栈

| 模块 | 技术 |
| --- | --- |
| 前端 | 原生 HTML、CSS、JavaScript |
| 后端 | Node.js、Express |
| 数据库 | SQLite、better-sqlite3 |
| 认证 | JWT、bcryptjs |
| 内容解析 | cheerio、jsonpath-plus |
| 规则引擎 | 自研 Legado 兼容解析引擎 |
| 媒体播放 | HTML5 Audio、HTML5 Video、HLS.js |
| 桌面端 | Tauri 2、Rust |
| 测试 | Node.js Built-in Test Runner |

## 项目结构

```text
.
├── app/                    # 前端单页应用
│   ├── index.html
│   ├── css/
│   ├── js/
│   └── vendor/
├── server/                 # Express 后端
│   ├── index.js            # 服务入口
│   ├── config.js           # 服务配置
│   ├── db/                 # SQLite 数据库与迁移
│   ├── engine/             # Legado 规则引擎
│   ├── middleware/         # JWT 认证
│   └── routes/             # API 路由
├── sources/                # 分类别内容源
├── shared/                 # 前后端共享配置
├── scripts/                # 构建、审计、清理和索引脚本
├── docs/                   # 格式及审计文档
├── src-tauri/              # Tauri 桌面端代码
├── dist/                   # 分发及便携版文件
├── start-yuedu.bat         # Windows 启动脚本
├── stop-yuedu.bat          # Windows 停止脚本
└── install-deps.bat        # Windows 依赖安装脚本
```

## 快速开始

### 环境要求

- Node.js 18 或更高版本
- npm
- Windows 用户可直接使用项目提供的 `.bat` 脚本

### 安装与启动

```bash
cd server
npm install
npm start
```

启动后访问：

```text
http://127.0.0.1:3456
```

开发模式：

```bash
cd server
npm run dev
```

### Windows 快速启动

在项目根目录双击 `start-yuedu.bat`。脚本会在依赖缺失时调用 `install-deps.bat`，然后启动服务并打开浏览器。

需要停止服务时运行：

```text
stop-yuedu.bat
```

## Tauri 桌面版

桌面版会自动启动内置后端，并在本地端口 `3456-3475` 范围内选择可用端口。用户数据库存放在应用数据目录中。

安装项目依赖：

```bash
npm install
cd server
npm install
cd ..
```

启动桌面开发版：

```bash
npm run tauri:dev
```

构建 Windows 安装包：

```bash
npm run tauri:build
```

构建命令会通过 `scripts/prepare_tauri_runtime.js` 准备内置 Node.js 运行时。桌面构建还需要 Rust、Tauri 的 Windows 构建依赖和 WebView2 环境。

## 配置项

后端可通过环境变量配置：

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3456` | HTTP 服务端口 |
| `HOST` | `127.0.0.1` | 监听地址 |
| `DB_PATH` | `server/data/yuedu.db` | SQLite 数据库路径 |
| `SOURCES_PATH` | `sources` | 内容源目录 |
| `JWT_SECRET` | 开发用内置值 | JWT 密钥 |
| `JWT_EXPIRES_IN` | `7d` | JWT 有效期 |
| `REQUEST_TIMEOUT_MS` | `15000` | 上游请求超时时间 |
| `JS_RUNTIME_TIMEOUT_MS` | `5000` | 规则脚本执行超时时间 |
| `MAX_SEARCH_RESULTS` | `20` | 最大搜索结果数 |
| `SEARCH_CONCURRENCY` | `8` | 搜索并发数 |
| `CORS_ORIGIN` | `*` | CORS 来源 |
| `ALLOW_PRIVATE_NETWORK_FETCH` | `false` | 是否允许请求内网地址 |
| `REJECT_UNAUTHORIZED` | 生产环境为 `true` | 是否校验 HTTPS 证书 |

生产环境必须设置自定义 JWT 密钥，否则服务会拒绝启动：

```powershell
$env:NODE_ENV="production"
$env:JWT_SECRET="请替换为高强度随机字符串"
cd server
npm start
```

## API

### 用户认证

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/api/auth/register` | 注册用户 |
| `POST` | `/api/auth/login` | 用户登录 |
| `GET` | `/api/auth/me` | 获取当前用户 |

### 内容源

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/sources` | 获取内容源列表 |
| `GET` | `/api/sources/:id` | 获取内容源详情 |
| `GET` | `/api/sources/categories` | 获取分类统计 |
| `GET` | `/api/sources/hot` | 获取热门内容源 |

### 内容访问

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/api/content/search` | 新版跨源搜索 |
| `GET/POST` | `/api/content/detail` | 获取内容详情 |
| `GET/POST` | `/api/content/entries` | 获取章节、目录或媒体列表 |
| `GET/POST` | `/api/content/payload` | 获取正文、图片或媒体内容 |
| `GET` | `/api/content/hls` | HLS 媒体代理 |
| `GET` | `/api/content/image` | 图片代理 |
| `POST` | `/api/search` | 旧版跨源搜索 |
| `GET` | `/api/reader/book` | 旧版书籍详情 |
| `GET` | `/api/reader/toc` | 旧版目录 |
| `GET` | `/api/reader/chapter` | 旧版章节 |

### 音乐

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/music/search` | 音乐搜索 |
| `GET` | `/api/music/play` | 获取播放地址 |
| `GET` | `/api/music/kuwo` | 酷我音乐接口 |
| `GET` | `/api/music/wangyi` | 网易云音乐接口 |

### 用户数据

以下接口需要携带 JWT：

```http
Authorization: Bearer <token>
```

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/favorites` | 获取收藏 |
| `POST` | `/api/favorites` | 添加收藏 |
| `DELETE` | `/api/favorites/:sourceId` | 删除收藏 |
| `GET` | `/api/history` | 获取阅读历史 |
| `POST` | `/api/history` | 写入阅读历史 |

服务状态接口：

```text
GET /api/health
GET /api/version
```

## 内容源维护

重新生成源索引：

```bash
node scripts/rebuild_index.js
```

静态检查或联网检查内容源：

```bash
node scripts/check_sources.js
node scripts/check_sources.js --connectivity
```

批量审计和验证阅读源：

```bash
node scripts/audit_all_sources.js
node scripts/validate_reading_sources.js --keyword 剑来 --limit 20
```

清理前进行预览：

```bash
node scripts/clean_sources.js --dry-run
```

构建前端数据和分类配置：

```bash
node scripts/build_category_meta.js
node scripts/build.js
```

更多源格式说明参见 [`docs/source_schema.md`](docs/source_schema.md)。

## 测试

测试位于 `server/tests`：

```bash
cd server
npm test
```

当前测试覆盖并发任务控制、分类配置生成、内网地址代理拦截、HTTP 请求安全策略和漫画源回退解析。

## 安全说明

- 默认仅监听 `127.0.0.1`
- 默认禁止代理访问内网和本机地址
- 生产环境必须设置 `JWT_SECRET`
- 内容源规则中的 JavaScript 会在受限运行环境中执行
- 不建议未经额外保护直接将服务暴露到公网
- 公网部署时应配置 HTTPS、反向代理、访问控制和严格的 CORS 来源

## 免责声明

本项目主要用于学习、研究和个人内容聚合。

内容源来自互联网公开配置，项目本身不托管第三方内容，也不保证外部站点的稳定性、合法性或持续可用性。使用者应遵守所在地区的法律法规、第三方网站服务条款及版权要求，请勿将本项目用于未经授权的内容传播或商业用途。

## 许可证

项目的 `package.json` 当前声明为 ISC License。仓库尚未提供独立的 `LICENSE` 文件，正式分发前建议补充该文件，并明确项目代码、内容源配置和第三方资源各自的授权范围。
