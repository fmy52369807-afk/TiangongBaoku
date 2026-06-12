# Legado 书源格式说明

本文档描述 Legado（阅读）App 的书源 JSON 格式，供新 App 开发和源解析参考。

## 顶层结构

书源文件是一个 JSON 数组，每个元素是一个书源对象。

```json
[
  { "bookSourceName": "示例书源", ... },
  { "bookSourceName": "另一个书源", ... }
]
```

## 源对象字段

### 基础信息

| 字段 | 类型 | 说明 |
|------|------|------|
| `bookSourceName` | string | 书源名称 |
| `bookSourceUrl` | string | 书源目标网站 URL |
| `bookSourceGroup` | string | 分组标签（如"小说 书源"、"音乐 书源"） |
| `bookSourceType` | number | 0=文本, 1=音频, 2=图片 |
| `bookSourceComment` | string | 注释/说明（可包含版本、作者、更新日志） |
| `bookUrlPattern` | string | 详情页 URL 匹配正则（可选） |

### 开关与状态

| 字段 | 类型 | 说明 |
|------|------|------|
| `enabled` | boolean | 是否启用 |
| `enabledCookieJar` | boolean | 是否启用 Cookie 管理 |
| `enabledExplore` | boolean | 是否启用发现页 |
| `eventListener` | boolean | 是否启用事件监听 |
| `customButton` | boolean | 是否有自定义按钮 |

### 排序和性能

| 字段 | 类型 | 说明 |
|------|------|------|
| `customOrder` | number | 自定义排序位置 |
| `weight` | number | 权重（影响搜索排序） |
| `respondTime` | number | 响应时间（毫秒） |
| `concurrentRate` | string | 并发限制（可选） |
| `lastUpdateTime` | number | 最后更新时间戳（毫秒） |

### 规则对象

#### ruleBookInfo — 书籍详情规则

| 字段 | 类型 | 说明 |
|------|------|------|
| `author` | string | 作者字段路径/规则 |
| `coverUrl` | string | 封面图 URL 规则 |
| `init` | string | 初始化规则（数据根路径） |
| `intro` | string | 简介规则 |
| `kind` | string | 分类/类型规则 |
| `lastChapter` | string | 最新章节名规则 |
| `name` | string | 书名规则 |
| `tocUrl` | string | 目录页 URL 规则 |
| `wordCount` | string | 字数规则 |

#### ruleContent — 正文规则

| 字段 | 类型 | 说明 |
|------|------|------|
| `content` | string | 正文提取规则 |
| `imageStyle` | string | 图片显示模式（FULL=全宽） |
| `replaceRegex` | string | 正则替换规则 |

#### ruleSearch — 搜索规则

| 字段 | 类型 | 说明 |
|------|------|------|
| `bookList` | string | 搜索结果列表规则 |
| `bookUrl` | string | 书籍 URL 规则 |
| `coverUrl` | string | 封面 URL 规则 |
| `intro` | string | 简介规则 |
| `kind` | string | 分类规则 |
| `name` | string | 书名规则 |
| `author` | string | 作者规则 |
| `lastChapter` | string | 最新章节规则 |
| `wordCount` | string | 字数规则 |
| `checkKeyWord` | string | 搜索验证关键词 |

#### ruleToc — 目录规则

| 字段 | 类型 | 说明 |
|------|------|------|
| `chapterList` | string | 章节列表规则 |
| `chapterName` | string | 章节名称规则 |
| `chapterUrl` | string | 章节 URL 规则 |
| `updateTime` | string | 更新时间规则 |
| `isVip` | string | VIP 标识规则 |
| `nextTocUrl` | string | 下一页目录规则 |

#### ruleExplore — 发现规则

| 字段 | 类型 | 说明 |
|------|------|------|
| `bookList` | string | 发现列表规则 |
| `bookUrl` | string | 书籍 URL 规则 |
| `coverUrl` | string | 封面 URL 规则 |
| `intro` | string | 简介规则 |
| `kind` | string | 分类规则 |
| `name` | string | 名称规则 |
| `author` | string | 作者规则 |
| `lastChapter` | string | 最新章节规则 |
| `wordCount` | string | 字数规则 |

### 其他字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `searchUrl` | string | 搜索 API URL |
| `exploreUrl` | string | 发现页 URL 配置 |
| `loginUrl` | string | 登录页 URL / JS 函数 |
| `loginUi` | string | 登录界面配置 JSON |
| `loginCheckJs` | string | 登录状态检测 JS |
| `header` | string | 自定义 HTTP 头（JSON 字符串） |
| `jsLib` | string | JS 公共库代码 |
| `variableComment` | string | 变量说明 |
| `exploreScreen` | string | 发现页筛选配置 |

## 规则语法

### JSONPath
```
$.data.books          — 从根取 data.books
$..songs[*]           — 递归查找所有 songs 数组
$.data[*].attributes  — 取 data 数组每项的 attributes
```

### CSS 选择器
```
.class-name           — 按 class 选取
tag.a@href            — 取 a 标签的 href
class.title@text      — 取元素的文本
#id-name              — 按 id 选取
```

### @js: 脚本
以 `@js:` 开头的值为 JavaScript 脚本，运行在阅读 App 的内置 JS 引擎中。
可用变量：`result`, `baseUrl`, `key`, `page`, `java`, `cookie`, `source`, `cache`, `book`, `chapter`

### 模板变量
```
{{$.field}}           — 取 JSONPath 结果
{{key}}               — 搜索关键词
{{page}}              — 当前页码
```

### 正则替换
```
##pattern##replacement — 正则替换
```

## 音乐源的 Legado 格式示例

方舟中 14 个"音乐 书源"也是用同样的格式，区别在于：
- `bookSourceType` 通常为 1（音频）
- `ruleToc` 映射的是音质/格式列表而非小说章节
- `ruleContent` 通常为空，搜索直接返回可播放 URL
- `searchUrl` 指向音乐搜索 API
