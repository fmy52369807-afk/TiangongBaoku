# EVC 文件分析

## 概述

`.evc` 是 AppRhyme（一个基于 Dart/Flutter 的音乐聚合应用）使用的自定义编码格式，用于分发自定义 API 插件。

## 文件来源

- **CDN 地址**: <https://cdn.jsdelivr.net/gh/hhhackor/AppRhymeApi@main/custom_api.evc>
- **当前文件**: `legacy/apprhyme_custom_api.evc`（8.8 KB）
- **用途**: 为 AppRhyme 提供酷我音乐和网易云音乐的播放信息获取能力

## EVC 格式结构

EVC (Encoded Value Container) 文件包含多个编码块：

### 1. 类型注册表
存储 Dart 类型到 ID 的映射，包括：
- 核心库类型：`dart:core` (5), `dart:async` (2), `dart:io` (6), `dart:convert` (4) 等
- 自定义包：`package:http_helper/helper.dart` (0), `package:crypto_helper/crypto.dart` (1), `package:api/main.dart` (9)

### 2. 类与函数注册表
包含所有使用的类和静态函数引用，例如：
- `HttpClient.getUrl`, `HttpClientRequest.close`, `HttpClientResponse.listen`
- `Utf8Codec.decode`, `Base64Codec.decode`, `JsonCodec.decode`
- `Uri.parse`, `Uri.encodeFull`, `String.fromCharCodes`
- `Completer.complete`, `Stream.listen`, `StreamController.add`

### 3. 字符串常量池
存储代码中使用的所有字符串常量：
- 音乐 API URL 模板
- HTTP header 名称和值
- JSON 字段路径
- 参数名称

### 4. 字节码段
编译后的 Dart 函数字节码，实现实际的 API 调用逻辑。

## 从 EVC 提取的 API 配置

### 酷我音乐 (getKuWoPlayInfo)
```
请求 URL:  https://mobi.kuwo.cn/mobi.s
请求方式:  GET
参数:
  f     = web
  prod  = kwplayer_ar_10.3.3.0
  type  = convert_url
  rid   = {music_rid}      — 音乐资源ID
  br    = {quality}         — 音质码率
Headers:
  User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) ...
  sec-ch-ua: "Chromium";v="124", "Google Chrome";v="124" ...

响应处理:
  解析响应中的 url, bitrate, format, size 字段
```

### 网易云音乐 (getWangYiPlayInfo)
```
请求 URL:  https://csm.sayqz.com/api/rhyme/
请求方式:  GET
参数:
  id    = {music_id}        — 音乐ID
  level = {quality_level}   — 音质级别
Headers: (同酷我)

响应处理:
  检查 code 字段判断成功/失败
  从 data 中解析 url, level, bitrate, format, size
```

### 统一接口 (getMusicPlayInfo)
根据参数中的 `type` 或 `source` 字段路由到对应的音乐平台接口。

## 在整合项目中的应用

由于 EVC 是 Dart 字节码，无法直接在新 App 中使用。建议：

1. **API 配置提取**: 已将 API 端点、参数、Header 提取到 `sources/music/apprhyme_api.json`
2. **重新实现**: 在新 App 中根据提取的配置重新实现 HTTP 调用逻辑
3. **Legado 格式桥接**: 可将这两个 API 封装为 Legado 格式的"音乐书源"，直接在新 App 中使用

## 安全考量

- 原始 EVC 中使用的是第三方中转 API（`csm.sayqz.com`），非官方 API
- 酷我 API 端点是官方公开接口
- 这些 API 仅供学习和研究使用
