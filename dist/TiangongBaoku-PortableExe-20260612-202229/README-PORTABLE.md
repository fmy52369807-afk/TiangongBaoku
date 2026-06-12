# 天工宝库 免 Node 便携版

## 启动

双击 StartTiangongBaoku.exe。

它会使用包内的 untime/node.exe 启动本地服务，并自动打开：

http://127.0.0.1:3456

## 停止

双击 StopTiangongBaoku.bat。

## 故障排查

如果 exe 没有打开页面，可以运行 StartTiangongBaoku-Console.bat 查看服务日志。

如果提示 3456 端口被占用，先运行停止脚本，再重新启动。

## 说明

此包不要求电脑预先安装 Node.js。开发目录、legacy/quarantine、docs、scripts、原始大源包和本地数据库运行文件未放入本包。
