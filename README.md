# 天工宝库 · TiangongBaoku

一站式阅读、漫画、音乐、影视内容聚合引擎。基于 Legado 书源格式，提供跨源搜索、在线阅读、多媒体播放的全栈 Web 应用。

## 快速开始

```bash
cd server
npm install
npm start
```

浏览器打开 `http://localhost:3456`

## 项目结构

```
.
├── app/                             # 📱 前端 SPA (三栏布局)
│   ├── index.html                   #   主页面 (浅色/深色主题)
│   ├── css/
│   │   └── app.css                  #   应用样式
│   ├── js/
│   │   ├── api-client.js            #   API 调用封装
│   │   ├── category-meta.js         #   分类展示配置 (由 shared/categories.json 生成)
│   │   ├── status-meta.js           #   状态展示配置
│   │   ├── ui-storage.js            #   UI 偏好本地存储
│   │   ├── app-state.js             #   全局状态
│   │   ├── app-shell.js             #   应用外壳与导航
│   │   ├── layout-ui.js             #   布局渲染
│   │   ├── source-filters.js        #   源筛选
│   │   ├── user-library.js          #   最近阅读与收藏
│   │   ├── results-panel.js         #   搜索结果与详情面板
│   │   ├── reader-modes.js          #   滑动/翻页阅读模式
│   │   ├── reader-panel.js          #   阅读器面板
│   │   ├── book-actions.js          #   书籍详情与收藏动作
│   │   ├── reader-actions.js        #   目录与章节动作
│   │   ├── app-events.js            #   页面事件绑定
│   │   ├── app-bootstrap.js         #   启动流程
│   │   ├── payload-renderers.js     #   多媒体渲染器
│   │   ├── audio-player.js          #   音频播放器
│   │   ├── main.js                  #   兼容入口占位
│   │   └── data.js                  #   源数据包 (构建生成)
│   └── vendor/
│       └── hls.min.js               #   HLS 视频支持
│
├── shared/
│   └── categories.json              #   前后端共享分类展示配置
│
├── server/                          # 🖥️ Express 后端
│   ├── index.js                     #   服务入口
│   ├── config.js                    #   配置 (端口/JWT/超时)
│   ├── db/
│   │   ├── database.js              #   SQLite 连接
│   │   └── migrations.js            #   数据库建表
│   ├── middleware/
│   │   └── auth.js                  #   JWT 认证中间件
│   ├── engine/
│   │   ├── legadoEngine.js          #   统一规则引擎 (862行)
│   │   ├── ruleParser.js            #   轻量规则解析器
│   │   ├── jsRuntime.js             #   JavaScript 沙箱
│   │   ├── httpClient.js            #   HTTP 代理 (gzip/SSL/重定向)
│   │   └── sourceAdapters.js        #   分类适配器
│   └── routes/
│       ├── auth.js                  #   注册 / 登录 / 用户信息
│       ├── sources.js               #   源浏览 / 分类
│       ├── search.js                #   旧版跨源搜索 (有界并发)
│       ├── content.js               #   内容路由 (搜索/详情/目录/正文，有界并发)
│       ├── reader.js                #   旧版阅读器路由
│       ├── music.js                 #   音乐搜索 / 播放 / 酷我 / 网易云
│       ├── favorites.js             #   收藏管理
│       └── history.js               #   阅读历史
│
├── sources/                         # 📦 源数据 (Legado 兼容格式)
│   ├── index.json                   #   总索引
│   ├── novel/                       #   📖 小说 (271条)
│   ├── comic/                       #   🎨 漫画 (51条)
│   ├── special/                     #   🔧 工具 (28条)
│   ├── audio/                       #   🎧 听书 (17条)
│   ├── video/                       #   🎬 影视 (17条)
│   ├── music/                       #   🎵 音乐 (7条)
│   └── game/                        #   🎮 游戏 (3条)
│
├── scripts/                         # 🛠️ 运维工具
│   ├── build.js                     #   构建前端数据包
│   ├── build_category_meta.js       #   生成前端分类配置脚本
│   ├── split_sources.js             #   拆分源文件
│   ├── audit_all_sources.js         #   批量审计源可用性
│   ├── audit_runtime_api.js         #   运行时 API 审计
│   ├── validate_reading_sources.js  #   验证阅读源
│   ├── prune_dead_sources.js        #   清理失效源
│   └── check_sources.js             #   静态源检查
│
├── dist/                            # 📦 分发包
│   └── TiangongBaoku-PortableExe-*.zip   # 免 Node 便携版
│
├── docs/                            # 📚 文档
│   ├── source_schema.md             #   Legado 源格式说明
│   └── evc_analysis.md              #   EVC 文件分析
│
└── .gitignore
```

## 技术栈

| 层 | 技术 |
|----|------|
| 后端 | Node.js + Express |
| 数据库 | better-sqlite3 |
| 认证 | JWT (jsonwebtoken + bcryptjs) |
| HTML 解析 | cheerio |
| JSON 查询 | jsonpath-plus |
| 规则引擎 | 自研 Legado 兼容引擎 (JSONPath + CSS + JS 沙箱) |
| 前端 | 原生 HTML/CSS/JS SPA (三栏布局) |
| 多媒体 | HTML5 Audio / HLS.js / 图片画廊 |

## 功能

### 已实现

- **跨源搜索**: 并行搜索 50+ 源，支持分页加载更多
- **分类浏览**: 7 个内容分类（小说/漫画/听书/音乐/影视/游戏/工具）
- **在线阅读**: 详情→目录→正文，字体缩放，上下章翻页，全屏阅读
- **漫画浏览**: 图片画廊模式
- **音乐播放**: 音频播放器，多源聚合
- **影视播放**: HLS 流媒体支持
- **用户系统**: 注册/登录，JWT 认证
- **收藏 & 历史**: 云端同步
- **浅色/深色主题**: 一键切换
- **响应式布局**: 桌面三栏 / 平板双栏 / 手机抽屉
- **规则引擎**: 支持 JSONPath、CSS 选择器、`@js:` 脚本、`||` 备选规则、`##` 正则替换、`{{$.field}}` 模板、`[attr$=]` 属性选择器、`~=` 管道符选择器
- **免 Node 便携版**: `dist/` 目录下提供打包好的 Windows exe

### 快捷操作

| 快捷键 | 功能 |
|--------|------|
| `/` | 聚焦搜索框 |
| `Esc` | 关闭面板/清除搜索 |
| `A+` / `A-` | 阅读字体缩放 |
| 按钮「全屏」 | 阅读器全屏模式 |

## API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/auth/register` | 注册 |
| POST | `/api/auth/login` | 登录 |
| GET  | `/api/auth/me` | 用户信息 |
| GET  | `/api/sources` | 源列表 (支持分页/分类筛选) |
| GET  | `/api/sources/:id` | 源详情 |
| GET  | `/api/sources/categories` | 分类统计 |
| POST | `/api/search` | 旧版跨源搜索 |
| POST | `/api/content/search` | 新版跨源搜索 (支持翻页) |
| GET  | `/api/content/detail` | 书籍详情 |
| GET  | `/api/content/entries` | 章节目录 |
| GET  | `/api/content/payload` | 章节正文/漫画图片/音视频 |
| GET  | `/api/music/search` | 音乐搜索 |
| GET  | `/api/music/play` | 音乐播放链接 |
| GET  | `/api/music/kuwo` | 酷我直连 |
| GET  | `/api/music/wangyi` | 网易云直连 |
| GET  | `/api/reader/book` | 旧版书籍详情 |
| GET  | `/api/reader/toc` | 旧版目录 |
| GET  | `/api/reader/chapter` | 旧版章节 |
| GET  | `/api/favorites` | 收藏列表 |
| POST | `/api/favorites` | 添加收藏 |
| DELETE | `/api/favorites/:id` | 取消收藏 |
| GET  | `/api/history` | 阅读历史 |
| POST | `/api/history` | 记录阅读 |
| GET  | `/api/version` | 服务版本 |

## 源数据

| 分类 | 数量 | 状态 |
|------|------|------|
| 📖 小说 | 271 | 5-8 个源搜索可用，八零小说阅读链路完整 |
| 🎨 漫画 | 51 | 1 个源搜索可用，目录规则待修复 |
| 🔧 工具 | 28 | 部分可用 |
| 🎧 听书 | 17 | 待验证 |
| 🎬 影视 | 17 | 1 个源搜索可用 |
| 🎵 音乐 | 7 | 2 个源搜索可用 |
| 🎮 游戏 | 3 | 待验证 |

源数据来自 B站"星之墨辰"整理的 Legado 书源 v7.1，采用 Legado 兼容格式，可直接导入阅读 App。

## 开发

```bash
# 安装依赖
cd server && npm install

# 开发模式 (热重载)
npm run dev

# 构建前端数据包
npm run build

# 审计所有源
node ../scripts/audit_all_sources.js
```

常用环境变量：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `3456` | 服务端口 |
| `DB_PATH` | `server/data/yuedu.db` | SQLite 数据库路径 |
| `REQUEST_TIMEOUT_MS` | `15000` | 上游请求超时 |
| `SEARCH_CONCURRENCY` | `8` | 跨源搜索最大并发数 |

## 许可

本项目的源配置均来自互联网公开资源，仅供学习研究使用。请勿用于商业用途。

---

🤖 天工宝库 · TiangongBaoku
