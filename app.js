const video = document.querySelector('#video');
const start = document.querySelector('#start');
const intro = document.querySelector('#intro');
const status = document.querySelector('#status');
const statusDot = status.querySelector('i');
const overlay = document.querySelector('#overlay');
const ctx = overlay.getContext('2d');
const faceOverlay = document.querySelector('#faceOverlay');
const faceCtx = faceOverlay.getContext('2d');
const diagnostics = document.querySelector('#diagnostics');
const detectCanvas = document.createElement('canvas');
const captureBtn = document.querySelector('#captureBtn');
const modeToggle = document.querySelector('#modeToggle');
const settingsPanel = document.querySelector('#settingsPanel');
const recognitionToggle = document.querySelector('#recognitionToggle');
const pauseToggle = document.querySelector('#pauseToggle');
const faceActionToggle = document.querySelector('#faceActionToggle');
const faceActionStatus = document.querySelector('#faceActionStatus');
const faceMeshToggle = document.querySelector('#faceMeshToggle');
const faceParticleToggle = document.querySelector('#faceParticleToggle');
const performanceToggle = document.querySelector('#performanceToggle');
const liveStats = document.querySelector('#liveStats');
const targetList = document.querySelector('#targetList');
const fpsValue = document.querySelector('#fpsValue');
const qualityValue = document.querySelector('#qualityValue');
const modeValue = document.querySelector('#modeValue');
const diagnosticToggle = document.querySelector('#diagnosticToggle');
const recordingBadge = document.querySelector('#recordingBadge');
const scanNotice = document.querySelector('#scanNotice');
let stream = null;
let front = false;
let model = null;
let lastTracks = [];
let visibleTracks = [];
const announcedTargets = new Set();
let noticeTimer = null;
let nextId = 1;
let detectionRunning = false;
let mediaRecorder = null;
let recordingChunks = [];
let recording = false;
let captureMode = 'photo';
let recognitionEnabled = false;
let recognitionPaused = false;
let faceActionEnabled = false;
let faceMesh = null;
let faceActionBusy = false;
let faceActionTimer = null;
let faceMeshVisible = true;
let faceParticlesVisible = true;
let smoothedFacePoints = null;
const faceRegionColors = ['#5df5c6', '#7aa7ff', '#ff6f91', '#ffd166', '#c792ff', '#64d8ff'];
let recordCanvas = null;
let recordContext = null;
let recordStream = null;
let recordFrame = 0;
let DETECT_WIDTH = 512;
let DETECT_HEIGHT = 288;
const DETECTION_THRESHOLD = 0.5;
const TRACK_HOLD_MS = 650;
let performanceMode = 'smooth';
let detectionInterval = 350;
let detectionSamples = [];
let scanMode = 'face';
let poseModel = null;
let smoothedPoses = [];
const poseConnections = [[5,7],[7,9],[6,8],[8,10],[5,6],[5,11],[6,12],[11,12],[11,13],[13,15],[12,14],[14,16]];

function diagnostic(text, visible = false) {
  diagnostics.textContent = text;
  diagnostics.hidden = !visible;
}

function announceTargets(tracks) {
  const fresh = tracks.find(track => !announcedTargets.has(track.id));
  if (!fresh) return;
  announcedTargets.add(fresh.id);
  scanNotice.textContent = `发现目标 ${String(fresh.id).padStart(2, '0')}`;
  scanNotice.hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { scanNotice.hidden = true; }, 3000);
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
  video.style.transform = front ? 'scaleX(-1)' : 'none';
  resizeOverlay();
  intro.hidden = true;
  liveStats.hidden = false;
  diagnostic('摄像头：已连接\n识别：未启动', false);
  document.querySelector('#count').textContent = '相机模式';
  setStatus('相机已打开', true);
  pauseToggle.disabled = true;
}

function resizeOverlay() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  overlay.width = Math.max(1, Math.floor(window.innerWidth * dpr));
  overlay.height = Math.max(1, Math.floor(window.innerHeight * dpr));
  overlay.style.width = '100%';
  overlay.style.height = '100%';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  faceOverlay.width = overlay.width;
  faceOverlay.height = overlay.height;
  faceOverlay.style.width = '100%';
  faceOverlay.style.height = '100%';
  faceCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  detectCanvas.width = DETECT_WIDTH;
  detectCanvas.height = DETECT_HEIGHT;
}

function faceDistance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function faceRatio(a, b, c, d) { return faceDistance(a, b) / Math.max(0.0001, faceDistance(c, d)); }
function clearFaceAction() {
  faceCtx.clearRect(0, 0, window.innerWidth, window.innerHeight);
  smoothedFacePoints = null;
  faceActionStatus.textContent = '人脸动作检测：未开启';
}
function faceRegionColor(index) {
  if (index >= 33 && index <= 160) return '#62f58b';
  if (index >= 263 && index <= 387) return '#ff647c';
  if (index >= 0 && index <= 32) return '#64d8ff';
  if (index >= 61 && index <= 291) return '#ffb45c';
  return faceRegionColors[index % faceRegionColors.length];
}
function drawFaceMesh(points) {
  const width = window.innerWidth, height = window.innerHeight;
  if (!smoothedFacePoints || smoothedFacePoints.length !== points.length) {
    smoothedFacePoints = points.map(point => ({ x: point.x, y: point.y, z: point.z || 0 }));
  } else {
    points.forEach((point, index) => {
      smoothedFacePoints[index].x += (point.x - smoothedFacePoints[index].x) * 0.42;
      smoothedFacePoints[index].y += (point.y - smoothedFacePoints[index].y) * 0.42;
      smoothedFacePoints[index].z += ((point.z || 0) - smoothedFacePoints[index].z) * 0.42;
    });
  }
  const drawPoints = smoothedFacePoints;
  const displayX = point => (front ? 1 - point.x : point.x);
  if (faceMeshVisible && window.FACEMESH_TESSELATION) {
    faceCtx.strokeStyle = 'rgba(150,210,255,.32)';
    faceCtx.lineWidth = 0.7;
    for (const [a, b] of FACEMESH_TESSELATION) {
      const p = drawPoints[a], q = drawPoints[b];
      faceCtx.beginPath(); faceCtx.moveTo(displayX(p) * width, p.y * height); faceCtx.lineTo(displayX(q) * width, q.y * height); faceCtx.stroke();
    }
  }
  drawPoints.forEach((point, index) => {
    if (!faceParticlesVisible && index % 4) return;
    faceCtx.fillStyle = faceRegionColor(index);
    faceCtx.shadowColor = faceCtx.fillStyle;
    faceCtx.shadowBlur = faceParticlesVisible ? 5 : 0;
    faceCtx.beginPath(); faceCtx.arc(displayX(point) * width, point.y * height, faceParticlesVisible ? 1.8 : 1.1, 0, Math.PI * 2); faceCtx.fill();
  });
  faceCtx.shadowBlur = 0;
}
function handleFaceResults(results) {
  if (!faceActionEnabled) return;
  faceCtx.clearRect(0, 0, window.innerWidth, window.innerHeight);
  const points = results.multiFaceLandmarks?.[0];
  if (!points) { faceActionStatus.textContent = '人脸动作检测：未检测到人脸'; return; }
  drawFaceMesh(points);
  const leftBlink = faceRatio(points[159], points[145], points[33], points[133]) < 0.18;
  const rightBlink = faceRatio(points[386], points[374], points[362], points[263]) < 0.18;
  const mouthOpen = faceRatio(points[13], points[14], points[61], points[291]) > 0.28;
  const nose = points[1], leftEye = points[33], rightEye = points[263];
  const midX = (leftEye.x + rightEye.x) / 2, eyeWidth = Math.max(0.001, Math.abs(rightEye.x - leftEye.x));
  const yaw = (nose.x - midX) / eyeWidth;
  const roll = Math.atan2(rightEye.y - leftEye.y, rightEye.x - leftEye.x) * 180 / Math.PI;
  const actions = [];
  if (leftBlink) actions.push('左眼眨眼');
  if (rightBlink) actions.push('右眼眨眼');
  if (mouthOpen) actions.push('张嘴');
  if (yaw > 0.14) actions.push('向左摇头'); else if (yaw < -0.14) actions.push('向右摇头');
  if (roll > 10) actions.push('向右歪头'); else if (roll < -10) actions.push('向左歪头');
  faceActionStatus.textContent = actions.length ? `人脸动作：✅ ${actions.join('、')}` : '人脸动作：正面、无明显动作';
}
async function startFaceAction() {
  if (!stream) { faceActionStatus.textContent = '请先打开相机'; return; }
  if (!window.FaceMesh) { faceActionStatus.textContent = 'FaceMesh 加载失败，请检查网络后刷新'; return; }
  if (!faceMesh) {
    faceMesh = new FaceMesh({ locateFile: file => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}` });
    faceMesh.setOptions({ maxNumFaces: 1, refineLandmarks: true, minDetectionConfidence: 0.6, minTrackingConfidence: 0.6 });
    faceMesh.onResults(handleFaceResults);
  }
  faceActionEnabled = true;
  faceActionToggle.textContent = '关闭人脸动作检测';
  faceActionStatus.textContent = '人脸动作检测：加载中…';
  if (!faceActionTimer) faceActionTimer = setInterval(async () => {
    if (!faceActionEnabled || faceActionBusy || !stream || video.readyState < 2) return;
    faceActionBusy = true;
    try { await faceMesh.send({ image: video }); } catch (error) { faceActionStatus.textContent = `人脸动作检测失败：${error.message}`; }
    faceActionBusy = false;
  }, 150);
}
function stopFaceAction() {
  faceActionEnabled = false;
  faceActionToggle.textContent = '开启人脸动作检测';
  clearFaceAction();
}

async function ensureDetection() {
  if (scanMode === 'body') {
    setStatus('加载全身模型');
    try { await ensurePoseModel(); setStatus('全身扫描中', true); detectionRunning = true; runBodyDetection(); }
    catch (error) { setStatus('全身模型加载失败'); diagnostic(`全身识别失败：${error.message}`, true); }
    return;
  }
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

async function ensurePoseModel() {
  if (poseModel) return poseModel;
  await ensureLibraries();
  if (!window.poseDetection) throw new Error('全身模型加载失败');
  poseModel = await poseDetection.createDetector(poseDetection.SupportedModels.PoseNet, { modelType: 'MobileNetV1', quantBytes: 2, architecture: 'MobileNetV1' });
  return poseModel;
}
function drawBodyPoses(poses) {
  ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
  ctx.lineWidth = Math.max(2, window.innerWidth / 420);
  smoothedPoses = poses.map((pose, poseIndex) => {
    const previous = smoothedPoses[poseIndex];
    const keypoints = pose.keypoints.map((point, pointIndex) => {
      const old = previous?.keypoints?.[pointIndex];
      if (!old || point.score < 0.35) return { ...point };
      return { ...point, x: old.x + (point.x - old.x) * 0.38, y: old.y + (point.y - old.y) * 0.38 };
    });
    return { ...pose, keypoints };
  });
  smoothedPoses.forEach((pose, index) => {
    const points = pose.keypoints.filter(point => point.score > 0.35);
    const color = ['#b7f5df', '#d6c8ff', '#ffd7a0', '#ff9aa9'][index % 4];
    ctx.strokeStyle = color; ctx.fillStyle = color;
    poseConnections.forEach(([a, b]) => {
      const p = pose.keypoints[a], q = pose.keypoints[b];
      if (!p || !q || p.score < 0.35 || q.score < 0.35) return;
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
    });
    points.forEach(point => { ctx.beginPath(); ctx.arc(point.x, point.y, 4, 0, Math.PI * 2); ctx.fill(); });
    const box = pose.keypoints.reduce((out, point) => point.score > 0.35 ? [Math.min(out[0], point.x), Math.min(out[1], point.y), Math.max(out[2], point.x), Math.max(out[3], point.y)] : out, [Infinity, Infinity, -Infinity, -Infinity]);
    if (Number.isFinite(box[0])) { ctx.font = '600 14px system-ui'; ctx.fillText(`目标 ${String(index + 1).padStart(2, '0')}`, box[0], Math.max(18, box[1] - 8)); }
  });
}
async function runBodyDetection() {
  if (!detectionRunning || scanMode !== 'body' || !poseModel) return;
  try {
    const poses = await poseModel.estimatePoses(video, { maxPoses: 4, flipHorizontal: false });
    if (!poses.length) smoothedPoses = [];
    drawBodyPoses(poses);
    document.querySelector('#count').textContent = `发现目标：${poses.length} 人`;
    qualityValue.textContent = poses.length ? '骨架已锁定' : '寻找人体';
  } catch (error) { diagnostic(`全身识别失败：${error.message}`, true); }
  setTimeout(runBodyDetection, detectionInterval);
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
  if (recognitionEnabled) announceTargets(tracks);
  targetList.hidden = !tracks.length;
  targetList.innerHTML = tracks.map(track => {
    const [, , , height] = track.box;
    const distance = height / Math.max(1, window.innerHeight) > 0.25 ? '近距离' : height / Math.max(1, window.innerHeight) > 0.05 ? '中距离' : '远距离';
    return `<div class="target-card"><strong>目标 ${String(track.id).padStart(2, '0')}</strong><span>${distance} · ${track.moved ? '移动中' : '静止'}</span></div>`;
  }).join('');
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
  if (scanMode !== 'face') return;
  if (detectionRunning) return;
  if (!recognitionEnabled || recognitionPaused || !model || !stream || video.readyState < 2) {
    if (!recognitionEnabled) scanNotice.hidden = true;
    setTimeout(runDetection, 500);
    return;
  }
  detectionRunning = true;
  const startedAt = performance.now();
  try {
    resizeOverlay();
    const detectContext = detectCanvas.getContext('2d', { willReadFrequently: true });
    detectContext.drawImage(video, 0, 0, DETECT_WIDTH, DETECT_HEIGHT);
    const predictions = await model.detect(detectCanvas, 5, DETECTION_THRESHOLD);
    const people = predictions.filter(p => p.class === 'person' && p.score >= DETECTION_THRESHOLD);
    let tracks = matchTracks(people.map(p => toDisplayBox(p.bbox)));
    if (tracks.length) {
      visibleTracks = tracks;
    } else if (visibleTracks.length && performance.now() - Math.max(...visibleTracks.map(t => t.seenAt)) < TRACK_HOLD_MS) {
      tracks = visibleTracks;
    } else {
      visibleTracks = [];
    }
    lastTracks = tracks.map(t => ({ id: t.id, cx: t.cx, cy: t.cy, seenAt: performance.now() }));
    document.querySelector('#count').textContent = `发现目标：${tracks.length} 人`;
    drawDetections(tracks);
    const elapsed = performance.now() - startedAt;
    detectionSamples.push(elapsed);
    if (detectionSamples.length > 8) detectionSamples.shift();
    const average = detectionSamples.reduce((sum, value) => sum + value, 0) / detectionSamples.length;
    fpsValue.textContent = `${Math.round(1000 / Math.max(1000 / 30, average + detectionInterval))} FPS`;
    qualityValue.textContent = tracks.length ? '已锁定' : '寻找目标';
  } catch (error) {
    console.warn('检测失败', error);
    diagnostic(`推理失败：${error.message}`, true);
  } finally {
    detectionRunning = false;
  }
  setTimeout(runDetection, detectionInterval);
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
  visibleTracks = [];
  announcedTargets.clear();
  clearTimeout(noticeTimer);
  scanNotice.hidden = true;
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
  targetContext.save();
  if (front) { targetContext.translate(width, 0); targetContext.scale(-1, 1); }
  targetContext.drawImage(video, (width - drawW) / 2, (height - drawH) / 2, drawW, drawH);
  targetContext.restore();
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
    recordingBadge.hidden = true;
    captureBtn.textContent = captureMode === 'photo' ? '拍照' : '录制';
    setStatus(recognitionEnabled ? '识别中' : '相机已打开', true);
  };
  mediaRecorder.start(1000);
  const draw = () => { if (!recording) return; drawVideoCover(recordCanvas, recordContext); recordFrame = requestAnimationFrame(draw); };
  recording = true; recordingBadge.hidden = false; captureBtn.textContent = '停止录制'; setStatus('录制中', true); draw();
}

captureBtn.addEventListener('click', () => {
  if (captureMode === 'photo') takePhoto();
  else if (recording) mediaRecorder.stop();
  else startRecording();
});
modeToggle.addEventListener('click', () => {
  captureMode = captureMode === 'photo' ? 'record' : 'photo';
  modeToggle.textContent = captureMode === 'photo' ? '录制模式' : '拍照模式';
  if (!recording) captureBtn.textContent = captureMode === 'photo' ? '拍照' : '录制';
});
recognitionToggle.addEventListener('click', () => {
  if (!stream) {
    setStatus('请先打开相机');
    return;
  }
  recognitionEnabled = !recognitionEnabled;
  recognitionToggle.textContent = recognitionEnabled ? '关闭识别' : '开始识别';
  pauseToggle.disabled = !recognitionEnabled;
  recognitionPaused = false;
  pauseToggle.textContent = '暂停识别';
  if (!recognitionEnabled) { lastTracks = []; visibleTracks = []; announcedTargets.clear(); clearTimeout(noticeTimer); targetList.hidden = true; ctx.clearRect(0, 0, window.innerWidth, window.innerHeight); scanNotice.hidden = true; document.querySelector('#count').textContent = '识别已关闭'; setStatus('相机模式', true); }
  else { setStatus('识别启动中', true); ensureDetection(); }
});
pauseToggle.addEventListener('click', () => {
  if (!recognitionEnabled) return;
  recognitionPaused = !recognitionPaused;
  pauseToggle.textContent = recognitionPaused ? '继续识别' : '暂停识别';
  if (recognitionPaused) {
    visibleTracks = [];
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    scanNotice.hidden = true;
    document.querySelector('#count').textContent = '识别已暂停';
    setStatus('识别已暂停', true);
  } else {
    setStatus('识别恢复中', true);
    document.querySelector('#count').textContent = '正在识别';
    runDetection();
  }
});
faceActionToggle.addEventListener('click', () => {
  if (faceActionEnabled) stopFaceAction();
  else startFaceAction();
});
faceMeshToggle.addEventListener('click', () => {
  faceMeshVisible = !faceMeshVisible;
  faceMeshToggle.textContent = faceMeshVisible ? '隐藏彩色网格' : '显示彩色网格';
});
faceParticleToggle.addEventListener('click', () => {
  faceParticlesVisible = !faceParticlesVisible;
  faceParticleToggle.textContent = faceParticlesVisible ? '关闭彩色粒子' : '开启彩色粒子';
});
performanceToggle.addEventListener('click', () => {
  performanceMode = performanceMode === 'smooth' ? 'detail' : 'smooth';
  if (performanceMode === 'smooth') {
    DETECT_WIDTH = 512; DETECT_HEIGHT = 288; detectionInterval = 350;
    performanceToggle.textContent = '性能模式：流畅'; modeValue.textContent = '流畅';
    setStatus('流畅模式', true);
  } else {
    DETECT_WIDTH = 640; DETECT_HEIGHT = 360; detectionInterval = 220;
    performanceToggle.textContent = '性能模式：清晰'; modeValue.textContent = '清晰';
    setStatus('清晰模式', true);
  }
  resizeOverlay();
});
document.querySelector('#scanModeToggle').addEventListener('click', async () => {
  scanMode = scanMode === 'face' ? 'body' : 'face';
  const button = document.querySelector('#scanModeToggle');
  button.textContent = scanMode === 'face' ? '扫描模式：人脸' : '扫描模式：全身';
  lastTracks = []; visibleTracks = []; ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
  if (faceActionEnabled) stopFaceAction();
  if (recognitionEnabled) { detectionRunning = false; setStatus('切换扫描模式中', true); setTimeout(() => { detectionRunning = true; ensureDetection(); }, 50); }
});
diagnosticToggle.addEventListener('click', () => { diagnostics.hidden = !diagnostics.hidden; });
document.querySelector('#settingsBtn').addEventListener('click', () => {
  settingsPanel.hidden = !settingsPanel.hidden;
  document.querySelector('#settingsBtn').textContent = settingsPanel.hidden ? '设置' : '收起设置';
  document.querySelector('#settingsBtn').setAttribute('aria-expanded', String(!settingsPanel.hidden));
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && stream) {
    if (video.readyState < 2) openCamera().catch(() => setStatus('请重新启动摄像头'));
    else runDetection();
  }
});
window.addEventListener('resize', resizeOverlay);
