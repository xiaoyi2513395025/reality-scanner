# 现实扫描器网页原型

这是一个浏览器摄像头原型：摄像头画面、人体检测、人数统计、目标编号和移动状态。

## 本地打开

摄像头不能用 `file:///` 直接打开。请在此目录启动 HTTPS 或 localhost 服务，然后打开服务地址。

```powershell
python -m http.server 4173
```

访问 `http://localhost:4173/`。

## 公开链接

把 `web-scanner` 目录上传到 GitHub 仓库，并在 Settings → Pages 中选择该目录对应的分支发布。GitHub Pages 会提供 HTTPS 链接，浏览器才会允许摄像头权限。

## 外部依赖

人体检测使用 TensorFlow.js 与 COCO-SSD，首次扫描时从 unpkg 下载公开开源脚本和模型权重。视频帧不会上传到本项目服务器。TensorFlow.js Models 使用 Apache-2.0；COCO-SSD 源码位于 tensorflow/tfjs-models。
