# Public Release Audit

审计时间：2026-08-10（Asia/Hong_Kong）
仓库：`fmy52369807-afk/TiangongBaoku`
范围：工作树、Git 跟踪文件、近期提交路径、运行时数据、书源格式、许可证和内容合规边界。

## 结论

当前发布树不包含本地 SQLite 数据库、构建产物或已识别的第三方 Authorization/Cookie 集合。`node scripts/audit_public_release.js --ci` 会扫描当前树并只输出命中路径与类型，不输出值。

这不等于 Git 历史自动被重写：历史提交中曾出现 `legacy/source_collection_v7.1.json`、`quarantine/removed_sources*.json` 和若干候选源 JSON，其中含第三方源配置里的 Authorization、Cookie 或脚本内密钥材料。它们不是 TiangongBaoku 的项目凭据，但一旦曾公开，相关服务方应按泄露处理并自行撤销/轮换。为避免继续分发，本版本从当前树删除了这些遗留集合、`data/` 和 `dist/`。

## 检查项

| 项目 | 方法 | 结果 |
| --- | --- | --- |
| API Key/Token/Cookie | `audit_public_release.js` 模式扫描；人工复核源/配置目录 | 当前树无命中；历史曾有第三方源认证材料，已不再随当前版本发布 |
| 数据库/个人信息 | 跟踪文件清单、数据库扩展名扫描 | `data/`、构建包内数据库已移除并加入忽略规则 |
| `.env`/本地配置 | `.gitignore` + 跟踪文件检查 | `.env*` 忽略，`.env.example` 仅含占位值；保留用户未提交的 `.claude/settings.local.json`，不加入提交 |
| Git 历史 | `git log --all --name-status`、敏感路径检索 | 历史对象可能仍可追溯；本次不做破坏性历史重写，发布说明要求轮换外部值 |
| 依赖许可证 | `package.json`、`server/package.json`、依赖 lockfile | 项目代码明确 ISC；依赖和外部书源仍按各自许可证/服务条款处理 |
| Legado 兼容性 | 引擎实现和 `docs/source_schema.md` 对照 | 独立 Node.js 兼容执行层，非 Legado Android/Kotlin 原版引擎 |

## 书源与内容合规

仓库内的源配置只描述如何请求公开页面或接口，不授予任何内容版权，也不保证目标站点持续可用。使用者必须自行确认来源授权、站点条款、robots、地区法律和账号权限；不要导入或提交需要个人账号的 Cookie、付费内容或受保护正文。项目维护者可以停用失效、侵权或要求下架的源。

## 安全基线

- 生产启动拒绝默认 JWT secret；公网部署需要 HTTPS、严格 CORS、限流、反向代理和日志脱敏。
- HTTP 客户端和媒体代理共享 DNS/IP 私网拦截，限制协议、重定向次数和请求超时。
- JavaScript 规则在 Node VM 受限沙箱中运行，网络由宿主 HTTP 层控制；这不是安全边界，不能执行不可信源集合而不做额外隔离。
- 代理只接受 HTTP(S) 目标；HLS manifest 的分片与 `#EXT-X-KEY` URI 会被重写为同一代理入口。

## 发布前复核

```powershell
npm test
node scripts/audit_public_release.js --ci
node scripts/collect_source_metrics.js --out docs/source-metrics.json
git diff --check
```

任何联网源验证都必须单独记录时间、Node/OS、关键词、样本数、成功/失败/超时/需登录数量以及 P50/P95；CI 不运行外部网络探测。

## v0.2.0 验证记录

- 离线测试：10/10 通过。
- 源清单：393 个配置，372 个启用配置。
- 外部源小样本：27 个，7 个搜索返回可解析条目；其余为空结果、失败、超时或跳过。该结果不代表内容授权或长期可用性。
- 匿名 Demo：5 个本地 fixture 覆盖文字、图片、音频和视频 Payload，不请求第三方内容。
- 桌面构建：Windows x64 NSIS 构建成功；校验值写入 v0.2.0 发布说明。
- 演示截图：本机 Playwright 浏览器启动连续超时，未发布旧截图或伪造截图。
