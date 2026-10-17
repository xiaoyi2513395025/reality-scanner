# 现实扫描器

纯前端手机摄像头实验项目，部署到 GitHub Pages 后可在支持摄像头的 Android Chrome、iPhone Safari 浏览器中运行。

## 当前功能

- 摄像头预览、前后镜头切换、拍照和浏览器录制
- COCO-SSD 人体检测：人数、目标编号、移动/静止、近/中/远游戏估计
- 人体检测暂停/继续和流畅/清晰性能模式
- FaceMesh 可选模式：468 个关键点、彩色网格、粒子、眨眼、张嘴、摇头和歪头
- PoseNet 可选全身模式：多人关键点、彩色骨架、平滑和短暂漏检保持
- 所有识别开关都在设置面板中，默认不启动人脸和全身模型

## 本地运行

摄像头不能可靠地在 `file:///` 页面中使用。推荐在本目录运行：

```powershell
python -m http.server 4173
```

然后访问 `http://localhost:4173/`。公开部署需要 HTTPS，例如 GitHub Pages。

## 隐私和限制

视频帧只在浏览器内交给模型处理；本项目没有后端、上传接口、WebSocket、人脸比对、身份库或人脸图片保存逻辑。模型脚本和权重从公开 CDN 下载，因此首次启动需要网络；“本地推理”不等于“完全离线”。

近/中/远是依据人体框大小的游戏估计，不是实际米数。年龄、性别和身份识别不在项目中。遮挡、暗光、侧身、小目标和多人交叉时可能漏检或换编号。

拍照和录制通过浏览器 Web Share、下载或系统文件面板保存；网页不能绕过 iOS/Android 权限静默写入相册或直接发送到微信。

## 参考项目和许可证

- [TensorFlow.js Models](https://github.com/tensorflow/tfjs-models)（Apache-2.0）
- [COCO-SSD](https://github.com/tensorflow/tfjs-models/tree/master/coco-ssd)（Apache-2.0）
- [Pose Detection](https://github.com/tensorflow/tfjs-models/tree/master/pose-detection)（Apache-2.0）
- [MediaPipe](https://github.com/google-ai-edge/mediapipe)（Apache-2.0）
- [Human](https://github.com/vladmandic/human)（MIT，作为研究参考，当前未直接接入）

`face-mesh/index.html` 是独立的 FaceMesh 测试页，不是主页面的后端或上传程序。
