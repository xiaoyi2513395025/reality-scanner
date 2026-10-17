const video = document.querySelector('#video');
const start = document.querySelector('#start');
const intro = document.querySelector('#intro');
const status = document.querySelector('#status');
const statusDot = status.querySelector('i');
const overlay = document.querySelector('#overlay');
const ctx = overlay.getContext('2d');
const diagnostics = document.querySelector('#diagnostics');
const detectCanvas = document.createElement('canvas');
const captureBtn = document.querySelector('#captureBtn');
const modeToggle = document.querySelector('#modeToggle');
const settingsPanel = document.querySelector('#settingsPanel');
const recognitionToggle = document.querySelector('#recognitionToggle');
const diagnosticToggle = document.querySelector('#diagnosticToggle');
let stream = null;
let front = false;
let model = null;
let lastTracks = [];
let nextId = 1;
let detectionRunning = false;
let mediaRecorder = null;
let recordingChunks = [];
let recording = false;
let captureMode = 'photo';
let recognitionEnabled = true;
let recordCanvas = null;
let recordContext = null;
let recordStream = null;
let recordFrame = 0;
const DETECT_WIDTH = 640;
const DETECT_HEIGHT = 360;

function diagnostic(text, visible = false) {
  diagnostics.textContent = text;
  diagnostics.hidden = !visible;
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`脚本加载失败: ${src}`));
    document.head.appendChild(script);
  });
}

async function ensureLibraries() {
  if (!window.tf) {
    try { await loadScript('https://unpkg.com/@tensorflow/tfjs@4.22.0/dist/tf.min.js'); }
    catch (e) { throw new Error('TensorFlow.js 加载失败'); }
  }
  if (!window.cocoSsd) {
    try { await loadScript('https://unpkg.com/@tensorflow-models/coco-ssd@2.2.3/dist/coco-ssd.min.js'); }
    catch (e) { throw new Error('COCO-SSD 加载失败'); }
  }
}

function setStatus(text, active = false) {
  status.lastChild.textContent = ` ${text}`;
  statusDot.classList.toggle('active', active);
}

async function openCamera() {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('当前浏览器不支持摄像头，请使用 HTTPS 的最新版 Safari 或 Chrome。');
  if (stream) stream.getTracks().forEach(track => track.stop());
  stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: front ? 'user' : 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }
  });
  video.srcObject = stream;
  await video.play();
  resizeOverlay();
  intro.hidden = true;
  diagnostic('摄像头：已连接\n正在准备识别模型…', true);
  setStatus('扫描中', true);
  ensureDetection();
}

function resizeOverlay() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  overlay.width = Math.max(1, Math.floor(window.innerWidth * dpr));
  overlay.height = Math.max(1, Math.floor(window.innerHeight * dpr));
  overlay.style.width = '100%';
  overlay.style.height = '100%';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  detectCanvas.width = DETECT_WIDTH;
  detectCanvas.height = DETECT_HEIGHT;
}

async function ensureDetection() {
  if (model) return;
  setStatus('加载识别模型');
  try {
    await ensureLibraries();
    diagnostic('摄像头：已连接\nTensorFlow.js：已加载\nCOCO-SSD：已加载\n正在下载模型权重…', true);
    model = await Promise.race([
      cocoSsd.load({ base: 'lite_mobilenet_v2' }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('model timeout')), 30000))
    ]);
    diagnostic('摄像头：已连接\nTensorFlow.js：已加载\nCOCO-SSD：已加载\n模型权重：已加载\n推理：运行中', true);
    setStatus('扫描中', true);
    runDetection();
  } catch (error) {
    console.error(error);
    setStatus('模型加载失败');
    diagnostic(`识别失败：${error.message}\n请检查网络后点击“重新扫描”。`, true);
  }
}

function matchTracks(detections) {
  const used = new Set();
  const now = performance.now();
  lastTracks = lastTracks.filter(t => now - t.seenAt < 1200);
  return detections.map(d => {
    const cx = d[0] + d[2] / 2;
    const cy = d[1] + d[3] / 2;
    let best = -1;
    let bestDistance = Infinity;
    lastTracks.forEach((t, index) => {
      if (used.has(index)) return;
      const distance = Math.hypot(cx - t.cx, cy - t.cy);
      if (distance < bestDistance) { best = index; bestDistance = distance; }
    });
    const limit = Math.min(window.innerWidth, window.innerHeight) * 0.15;
    const track = best >= 0 && bestDistance < limit
      ? { id: lastTracks[best].id, cx, cy, moved: bestDistance > Math.min(window.innerWidth, window.innerHeight) * 0.02, seenAt: now }
      : { id: nextId++, cx, cy, moved: false, seenAt: now };
    if (best >= 0 && bestDistance < limit) used.add(best);
    return { ...track, box: d };
  });
}

function drawDetections(tracks) {
  const cw = window.innerWidth;
  const ch = window.innerHeight;
  ctx.clearRect(0, 0, cw, ch);
  ctx.lineWidth = Math.max(2, cw / 500);
  ctx.font = `${Math.max(14, cw / 55)}px monospace`;
  tracks.forEach(t => {
    const [x, y, w, h] = t.box;
    const ratio = h / ch;
    const distance = ratio > 0.25 ? '近距离' : ratio > 0.05 ? '中距离' : '远距离';
    ctx.strokeStyle = '#27f0bd';
    ctx.strokeRect(x, y, w, h);
    const label = `目标 ${String(t.id).padStart(2, '0')} · ${distance} · ${t.moved ? '移动中' : '静止'}`;
    const labelWidth = ctx.measureText(label).width + 14;
    ctx.fillStyle = 'rgba(0,0,0,.68)';
    ctx.fillRect(x, Math.max(0, y - 28), labelWidth, 26);
    ctx.fillStyle = '#27f0bd';
    ctx.fillText(label, x + 7, Math.max(19, y - 9));
  });
}

function toDisplayBox(box) {
  const [x, y, w, h] = box;
  const vw = video.videoWidth || DETECT_WIDTH;
  const vh = video.videoHeight || DETECT_HEIGHT;
  const cw = window.innerWidth;
  const ch = window.innerHeight;
  const scale = Math.max(cw / vw, ch / vh);
  const offsetX = (cw - vw * scale) / 2;
  const offsetY = (ch - vh * scale) / 2;
  return [x * (vw / DETECT_WIDTH) * scale + offsetX, y * (vh / DETECT_HEIGHT) * scale + offsetY, w * (vw / DETECT_WIDTH) * scale, h * (vh / DETECT_HEIGHT) * scale];
}

async function runDetection() {
  if (detectionRunning) return;
  if (!recognitionEnabled || !model || !stream || video.readyState < 2) {
    setTimeout(runDetection, 500);
    return;
  }
  detectionRunning = true;
  try {
    resizeOverlay();
    const detectContext = detectCanvas.getContext('2d', { willReadFrequently: true });
    detectContext.drawImage(video, 0, 0, DETECT_WIDTH, DETECT_HEIGHT);
    const predictions = await model.detect(detectCanvas, 5, 0.55);
    const people = predictions.filter(p => p.class === 'person');
    const tracks = matchTracks(people.map(p => toDisplayBox(p.bbox)));
    lastTracks = tracks.map(t => ({ id: t.id, cx: t.cx, cy: t.cy, seenAt: performance.now() }));
    document.querySelector('#count').textContent = `发现目标：${tracks.length} 人`;
    drawDetections(tracks);
  } catch (error) {
    console.warn('检测失败', error);
    diagnostic(`推理失败：${error.message}`, true);
  } finally {
    detectionRunning = false;
  }
  setTimeout(runDetection, 250);
}

start.addEventListener('click', async () => {
  try { await openCamera(); } catch (error) { setStatus('启动失败'); alert(error.message); }
});
document.querySelector('#switchBtn').addEventListener('click', async () => {
  if (!stream) return;
  front = !front;
  try { await openCamera(); } catch (error) { setStatus('切换失败'); alert(error.message); }
});
document.querySelector('#rescanBtn').addEventListener('click', () => {
  if (!stream) return start.click();
  lastTracks = [];
  nextId = 1;
  setStatus('重新扫描中', true);
  setTimeout(() => setStatus('扫描中', true), 500);
});
function drawVideoCover(target, targetContext) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = window.innerWidth * dpr;
  const height = window.innerHeight * dpr;
  const vw = video.videoWidth || width;
  const vh = video.videoHeight || height;
  const scale = Math.max(width / vw, height / vh);
  const drawW = vw * scale;
  const drawH = vh * scale;
  targetContext.fillStyle = '#050b16';
  targetContext.fillRect(0, 0, width, height);
  targetContext.drawImage(video, (width - drawW) / 2, (height - drawH) / 2, drawW, drawH);
  targetContext.drawImage(overlay, 0, 0, width, height);
}

function compositeBlob(type = 'image/jpeg') {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(window.innerWidth * dpr));
  canvas.height = Math.max(1, Math.floor(window.innerHeight * dpr));
  drawVideoCover(canvas, canvas.getContext('2d'));
  return new Promise(resolve => canvas.toBlob(resolve, type, .9));
}

async function shareOrDownload(blob, filename, shareTitle) {
  const file = new File([blob], filename, { type: blob.type });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ title: shareTitle, files: [file] }); return; } catch (error) { if (error.name === 'AbortError') return; }
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = filename; link.target = '_blank'; link.rel = 'noopener';
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  alert('文件已生成。若浏览器没有自动保存，请在新页面打开文件后使用分享菜单，选择“存储图像”或“存储到文件”。');
}

async function takePhoto() {
  if (!stream || video.readyState < 2) return alert('请先开始扫描。');
  const blob = await compositeBlob('image/jpeg');
  await shareOrDownload(blob, `reality-scan-${Date.now()}.jpg`, '现实扫描器照片');
}

function startRecording() {
  if (!stream) return alert('请先开始扫描。');
  if (!window.MediaRecorder) return alert('当前浏览器不支持网页录制。');
  if (!HTMLCanvasElement.prototype.captureStream) return alert('当前浏览器不支持录制识别画面。');
  const mimeType = ['video/mp4;codecs=h264', 'video/webm;codecs=vp8', 'video/webm'].find(type => MediaRecorder.isTypeSupported(type));
  if (!mimeType) return alert('当前浏览器不支持网页录制。');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  recordCanvas = document.createElement('canvas');
  recordCanvas.width = Math.max(1, Math.floor(window.innerWidth * dpr));
  recordCanvas.height = Math.max(1, Math.floor(window.innerHeight * dpr));
  recordContext = recordCanvas.getContext('2d');
  recordStream = recordCanvas.captureStream(24);
  recordingChunks = [];
  mediaRecorder = new MediaRecorder(recordStream, { mimeType, videoBitsPerSecond: 1800000 });
  mediaRecorder.ondataavailable = event => { if (event.data.size) recordingChunks.push(event.data); };
  mediaRecorder.onstop = () => {
    const blob = new Blob(recordingChunks, { type: mimeType });
    shareOrDownload(blob, `reality-scan-${Date.now()}.${mimeType.includes('mp4') ? 'mp4' : 'webm'}`, '现实扫描器录像');
    recordStream.getTracks().forEach(track => track.stop());
    cancelAnimationFrame(recordFrame);
    recording = false;
    captureBtn.textContent = captureMode === 'photo' ? '拍照' : '录制';
    setStatus('扫描中', true);
  };
  mediaRecorder.start(1000);
  const draw = () => { if (!recording) return; drawVideoCover(recordCanvas, recordContext); recordFrame = requestAnimationFrame(draw); };
  recording = true; captureBtn.textContent = '停止录制'; setStatus('录制中', true); draw();
}

captureBtn.addEventListener('click', () => {
  if (captureMode === 'photo') takePhoto();
  else if (recording) mediaRecorder.stop();
  else startRecording();
});
modeToggle.addEventListener('click', () => {
  captureMode = captureMode === 'photo' ? 'record' : 'photo';
  modeToggle.textContent = captureMode === 'photo' ? '切换：录制' : '切换：拍照';
  if (!recording) captureBtn.textContent = captureMode === 'photo' ? '拍照' : '录制';
});
recognitionToggle.addEventListener('click', () => {
  recognitionEnabled = !recognitionEnabled;
  recognitionToggle.textContent = recognitionEnabled ? '关闭识别' : '开始识别';
  if (!recognitionEnabled) { lastTracks = []; ctx.clearRect(0, 0, window.innerWidth, window.innerHeight); document.querySelector('#count').textContent = '识别已关闭'; setStatus('相机模式', true); }
  else { setStatus('识别启动中', true); ensureDetection(); }
});
diagnosticToggle.addEventListener('click', () => { diagnostics.hidden = !diagnostics.hidden; });
document.querySelector('#settingsBtn').addEventListener('click', () => { settingsPanel.hidden = false; });
document.querySelector('#closeSettings').addEventListener('click', () => { settingsPanel.hidden = true; });
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && stream) {
    if (video.readyState < 2) openCamera().catch(() => setStatus('请重新启动摄像头'));
    else runDetection();
  }
});
window.addEventListener('resize', resizeOverlay);
