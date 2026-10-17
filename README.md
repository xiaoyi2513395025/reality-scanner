# 现实扫描器网页原型

这是一个浏览器摄像头原型：摄像头画面、人体检测、人数统计、目标编号、移动状态和近/中/远距离估计。

为了降低手机卡顿，检测使用 640×360 的缩略帧，每 250 毫秒检测一次，最多取 5 个目标；摄像头预览保持独立运行。检测结果是游戏用途的估计，不是精确测量。

## 本地打开

摄像头不能用 `file:///` 直接打开。请在此目录启动 HTTPS 或 localhost 服务，然后打开服务地址。

```powershell
python -m http.server 4173
```

访问 `http://localhost:4173/`。

## 公开链接

把 `web-scanner` 目录上传到 GitHub 仓库，并在 Settings → Pages 中选择该目录对应的分支发布。GitHub Pages 会提供 HTTPS 链接，浏览器才会允许摄像头权限。

## 外部依赖

人体检测使用 TensorFlow.js 与 COCO-SSD，首次扫描时从 unpkg 和 TensorFlow 的模型存储下载公开开源脚本和模型权重。视频帧不会上传到本项目服务器；当前版本没有 `fetch`、WebSocket 或上传接口。TensorFlow.js Models 使用 Apache-2.0；COCO-SSD 源码位于 tensorflow/tfjs-models。

拍照会生成本地图片：支持 Web Share 的手机会打开系统分享面板，用户可选择“存储图像”；其他浏览器使用下载或新标签页保存。网页不能绕过 iOS/安卓权限静默写入系统相册。

录制使用浏览器 MediaRecorder 录制本地摄像头流；停止后通过系统分享或下载保存。录制格式由浏览器决定，部分 Safari 使用 MP4，部分浏览器使用 WebM。
