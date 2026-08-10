# TiangongBaoku v0.2.0

这是面向公开作品集和 2026 秋招面试展示的工程化版本，重点补齐真实架构说明、离线测试、匿名 Demo、指标口径、安全审计、CI 和 Windows 桌面构建。

## 核心变化

- 明确项目是独立 Node.js/Express Legado 兼容执行层，不包含 Legado Android/Kotlin 原版引擎。
- 规则链支持常用 CSS Selector、JSONPath、模板变量、备选规则、正则替换、受限 JavaScript 和部分 `java.*` 适配 API。
- 跨源搜索使用并发上限、单源超时和故障隔离，输出统一 Payload 给 Web/Tauri 客户端。
- SQLite 保存用户态数据；媒体代理执行协议、DNS/IP 私网拦截、重定向控制和 HLS URI 重写。
- 新增 5 类匿名本地 fixture，验证搜索、详情、目录、文字、图片、音频和视频链路。
- 新增 Node 18/20/22 CI、10 项离线测试、启动基准、匿名外部源小样本和公开发布审计。

## 实测结果

环境：2026-08-10，Windows x64，Node v24.15.0，20 个逻辑处理器。

- 离线测试：10/10 通过。
- 配置清单：393 个源配置，372 个启用配置。
- 外部源样本：分类抽取 27 个，固定关键词、单源超时 2500ms；7 成功、1 空结果、10 失败、3 超时、6 跳过。
- 样本延迟：P50 568.7ms，P95 2736.7ms；搜索返回可解析条目的比例为 25.9%。
- 本地规则微基准：100 次，P50 0.049ms，P95 0.177ms。
- Demo 冷启动：7 次，P50 662.4ms，P95 923.6ms。

`verified=7` 只表示本次固定样本搜索返回可解析条目，不代表全部启用配置可用，不证明详情/正文持续有效，也不构成内容授权或服务 SLA。

## Windows 安装包

- 文件：`天工宝库_0.2.0_x64-setup.exe`
- 大小：41,177,247 bytes
- SHA-256：`E155970BF68AE4D0BD2D3C5038C3389CD7E681CC78553883456D49EE8F2023B9`

安装包由本仓库 `npm run tauri:build` 在 Windows x64 环境生成，内置 Node 运行时并通过 Tauri 2/NSIS 打包。

## 兼容范围与限制

- 兼容常见 Legado 书源字段和规则语义，不保证复杂 Android/Java API、登录交互、验证码、站点专有加密和所有历史书源规则。
- JavaScript 规则运行在受限 Node VM 中，但 VM 不是强安全隔离；不要直接执行未经审核的不可信源集合。
- 第三方源会失效、限流、要求登录或改变内容；外部验证不在 CI 中运行。
- 本项目不托管第三方内容，源配置不等于版权或访问授权。使用者需遵守站点条款、robots、版权和当地法律。
- 当前树已移除本地数据库、旧构建包和识别到的第三方认证材料，但 Git 历史未做破坏性重写；历史外部凭据应由相关服务方撤销或轮换。
- Playwright CLI/Chromium 在本次 Windows 环境启动连续超时，因此未发布 v0.2.0 新截图；匿名 fixture、截图脚本和离线 Demo 集成测试均保留。

## 验证命令

```powershell
npm ci
npm ci --prefix server
npm test
node scripts/audit_public_release.js --ci
node scripts/collect_source_metrics.js --out docs/source-metrics.json
node scripts/benchmark_startup.js --iterations 7 --out docs/runtime-metrics.json
node scripts/verify_sources.js --sample 28 --out docs/source-verification.json
npm run tauri:build
```
