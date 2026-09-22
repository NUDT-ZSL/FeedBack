import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// ---------- renderer / scene ----------
const app = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0e13);
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 1e7);
camera.position.set(1, 1, 1);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---------- LOD level colors (debug view + HUD) ----------
const LEVEL_COLORS = ['#ff5555', '#ffaa33', '#ffee55', '#77ff66', '#44ddff',
  '#5588ff', '#bb66ff', '#ff66aa', '#ffffff', '#999999', '#66ffdd', '#cc8844', '#88aa00']
  .map(h => new THREE.Color(h));

// ---------- point shader: stochastic density crossfade ----------
const VERT = `
attribute float aRand;
uniform float uWeight;
uniform float uPointScale;
uniform float uSpacing;
uniform vec3 uLevelColor;
uniform float uLodColor;
varying vec3 vColor;
void main() {
  vColor = mix(color, uLevelColor, uLodColor);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float on = step(aRand, uWeight);
  float px = uPointScale * uSpacing / max(-mv.z, 0.001);
  gl_PointSize = on * clamp(px, 1.0, 64.0);
  gl_Position = on > 0.5 ? projectionMatrix * mv : vec4(2.0, 2.0, 2.0, 1.0);
}`;
const FRAG = `
varying vec3 vColor;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  if (dot(c, c) > 0.25) discard;
  gl_FragColor = vec4(vColor, 1.0);
}`;

// ---------- state ----------
const infos = new Map();     // id -> header {level,count,bboxMin,bboxMax,children,spacing,box3}
const recs = new Map();      // id -> {status, mesh, weight, refined, material}
const requestQueue = [];
const inFlight = new Set();
const desired = new Set();
const placeholders = new Set();
let meta = null;
let tau = 1e-3;              // angular-error threshold (adaptive)
let pointBudget = 2_500_000;
let renderedPoints = 0;
const MAX_CONCURRENT = 8;
const frustum = new THREE.Frustum();
const projView = new THREE.Matrix4();
const TEST_MODE = new URLSearchParams(location.search).has('test');

function levelColor(level) { return LEVEL_COLORS[Math.min(level, LEVEL_COLORS.length - 1)]; }

function clearDataset() {
  for (const rec of recs.values()) {
    if (rec.mesh) {
      scene.remove(rec.mesh);
      rec.mesh.geometry.dispose();
      rec.mesh.material.dispose();
    }
  }
  infos.clear(); recs.clear(); requestQueue.length = 0; inFlight.clear();
  desired.clear(); placeholders.clear();
}
// ---------- node fetching ----------
function requestNode(id) {
  if (infos.has(id) || inFlight.has(id) || requestQueue.includes(id)) return;
  requestQueue.push(id);
}

function pumpQueue() {
  while (inFlight.size < MAX_CONCURRENT && requestQueue.length) {
    const id = requestQueue.shift();
    inFlight.add(id);
    fetch('/api/node/' + id)
      .then(r => { if (!r.ok) throw new Error('node ' + id + ': ' + r.status); return r.arrayBuffer(); })
      .then(buf => { buildNode(id, buf); })
      .catch(err => console.warn(err))
      .finally(() => inFlight.delete(id));
  }
}

function buildNode(id, buf) {
  const dv = new DataView(buf);
  const hlen = dv.getUint32(0, true);
  const info = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, hlen)));
  info.box3 = new THREE.Box3(
    new THREE.Vector3(...info.bboxMin), new THREE.Vector3(...info.bboxMax));
  infos.set(id, info);
  const n = info.count;
  const off = 4 + hlen;
  const pos = new Float32Array(buf, off, n * 3);
  const col = new Uint8Array(buf, off + n * 12, n * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3, true)); // normalized 0..1
  const rand = new Float32Array(n);
  for (let i = 0; i < n; i++) {  // stable hash per point index -> flicker-free fade
    let h = (i * 2654435761) >>> 0;
    h ^= h >>> 15; h = (h * 2246822519) >>> 0; h ^= h >>> 13;
    rand[i] = h / 4294967295;
  }
  geo.setAttribute('aRand', new THREE.BufferAttribute(rand, 1));
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG, vertexColors: true,
    uniforms: {
      uWeight: { value: 0 }, uPointScale: { value: 1.0 },
      uSpacing: { value: info.spacing },
      uLevelColor: { value: levelColor(info.level) },
      uLodColor: { value: 0 },
    },
  });
  const mesh = new THREE.Points(geo, mat);
  mesh.frustumCulled = false;
  mesh.visible = false;
  scene.add(mesh);
  recs.set(id, { status: 'ready', mesh, weight: 0, refined: false, material: mat });
}

function nearestLoadedAncestor(id) {
  let cur = id;
  while (cur.length > 1) {
    cur = cur.slice(0, -1);
    const rec = recs.get(cur);
    if (rec && rec.status === 'ready') return cur;
  }
  return recs.has('r') && recs.get('r').status === 'ready' ? 'r' : null;
}
// ---------- LOD traversal ----------
const _v = new THREE.Vector3();
const _size = new THREE.Vector3();
function selectNodes() {
  desired.clear(); placeholders.clear();
  projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  frustum.setFromProjectionMatrix(projView);
  const pixelAngle = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) / innerHeight;
  const tauBase = pixelAngle * 2.0;          // point spacing < ~2 px on screen
  const stack = ['r'];
  while (stack.length) {
    const id = stack.pop();
    const info = infos.get(id);
    if (!info) {                              // header unknown: fetch + placeholder
      requestNode(id);
      addDesired(id);
      continue;
    }
    if (!frustum.intersectsBox(info.box3)) continue;   // view-frustum culling
    info.box3.getCenter(_v);
    const dist = Math.max(camera.position.distanceTo(_v) - info.box3.getSize(_size).length() / 2, 1e-3);
    const err = info.spacing / dist;          // angular size of sample spacing
    const rec = recs.get(id);
    const refined = rec ? rec.refined : false;
    const threshold = refined ? tau * 0.7 : tau;       // hysteresis: no flicker at boundaries
    if (info.children.length && err > threshold) {
      if (rec) rec.refined = true;
      for (const c of info.children) stack.push(c);
    } else {
      if (rec) rec.refined = false;
      addDesired(id);
    }
  }
  // adaptive point budget keeps the frame rate stable
  if (renderedPoints > pointBudget) tau *= 1.04;
  else if (renderedPoints < pointBudget * 0.6) tau = Math.max(tau * 0.96, tauBase);
  tau = Math.max(tau, tauBase);
}

function addDesired(id) {
  const rec = recs.get(id);
  if (rec && rec.status === 'ready') { desired.add(id); return; }
  requestNode(id);
  const anc = nearestLoadedAncestor(id);      // low-detail placeholder until ready
  if (anc) { desired.add(anc); placeholders.add(anc); }
}

function updateWeights(dt) {
  renderedPoints = 0;
  const k = TEST_MODE ? 1 : Math.min(1, dt * 5.0);   // density easing speed
  // world-spacing -> pixel size factor so points exactly cover their sample spacing
  const pxFactor = (innerHeight / 2) / Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
  for (const [id, rec] of recs) {
    if (rec.status !== 'ready') continue;
    const target = desired.has(id) ? 1 : 0;
    rec.weight += (target - rec.weight) * k;
    if (rec.weight < 0.02 && target === 0) { rec.mesh.visible = false; continue; }
    rec.mesh.visible = true;
    rec.material.uniforms.uWeight.value = rec.weight;
    rec.material.uniforms.uLodColor.value = lodColorOn ? 1 : 0;
    rec.material.uniforms.uPointScale.value = pxFactor;
    renderedPoints += Math.round(infos.get(id).count * rec.weight);
  }
}

// ---------- HUD ----------
const el = id => document.getElementById(id);
let fpsEMA = 60, hudTimer = 0;
function updateHUD(dt) {
  fpsEMA += ((1 / Math.max(dt, 1e-4)) - fpsEMA) * 0.05;
  hudTimer += dt;
  if (!TEST_MODE && hudTimer < 0.25) return;
  hudTimer = 0;
  el('fps').textContent = fpsEMA.toFixed(0);
  el('pts').textContent = renderedPoints.toLocaleString();
  el('loaded').textContent = [...recs.values()].filter(r => r.status === 'ready').length
    + ' / ' + (meta ? meta.nodeCount : 0);
  el('loading').textContent = inFlight.size + ' / ' + requestQueue.length;
  el('placeholder').textContent = placeholders.size;
  el('budget').textContent = pointBudget.toLocaleString();
  const perLevel = new Map();
  for (const id of desired) {
    const lv = infos.get(id).level;
    perLevel.set(lv, (perLevel.get(lv) || 0) + 1);
  }
  const maxCnt = Math.max(1, ...perLevel.values());
  let html = '';
  for (const lv of [...perLevel.keys()].sort((a, b) => a - b)) {
    const c = perLevel.get(lv);
    const col = '#' + levelColor(lv).getHexString();
    html += '<div class="barRow"><span class="lab">L' + lv + '</span>' +
      '<div class="bar" style="width:' + (140 * c / maxCnt) + 'px;background:' + col + '"></div>' +
      '<span class="cnt">' + c + ' 节点</span></div>';
  }
  el('lodBars').innerHTML = html || '<span style="color:#9fb3c8">无可见节点</span>';
}
// ---------- dataset loading ----------
let lodColorOn = false;
if (new URLSearchParams(location.search).has('lodcolor')) {
  lodColorOn = true;
  el('lodColor').checked = true;
}
el('lodColor').addEventListener('change', e => { lodColorOn = e.target.checked; });

async function loadDataset(url, opts, label) {
  const msg = el('loadMsg');
  msg.textContent = '正在解析并构建八叉树 LOD：' + label + ' ...';
  try {
    const r = await fetch(url, opts);
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || r.statusText);
    clearDataset();
    meta = j;
    tau = 1e-3;
    const c = new THREE.Vector3(
      (j.bboxMin[0] + j.bboxMax[0]) / 2,
      (j.bboxMin[1] + j.bboxMax[1]) / 2,
      (j.bboxMin[2] + j.bboxMax[2]) / 2);
    const size = Math.max(j.bboxMax[0] - j.bboxMin[0],
                          j.bboxMax[1] - j.bboxMin[1],
                          j.bboxMax[2] - j.bboxMin[2]);
    controls.target.copy(c);
    camera.position.set(c.x + size * 0.8, c.y + size * 0.6, c.z + size * 0.8);
    camera.near = size / 10000; camera.far = size * 20;
    camera.updateProjectionMatrix();
    controls.update();
    const z = parseFloat(new URLSearchParams(location.search).get('zoom'));
    if (z > 0) camera.position.sub(c).multiplyScalar(z).add(c);
    msg.textContent = j.name + '：' + j.totalPoints.toLocaleString() +
      ' 点，' + j.nodeCount + ' 节点，构建 ' + (j.buildSeconds ?? '-') + 's';
    requestNode('r');
  } catch (err) {
    msg.textContent = '加载失败：' + err.message;
  }
}

el('loadPathBtn').addEventListener('click', () => {
  const p = el('pathInput').value.trim();
  if (!p) { el('loadMsg').textContent = '请输入文件路径'; return; }
  loadDataset('/api/load', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: p }),
  }, p);
});
el('loadSampleBtn').addEventListener('click', () => {
  loadDataset('/api/load', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: 'data/sample.ply' }),
  }, 'data/sample.ply');
});
el('fileInput').addEventListener('change', e => {
  const f = e.target.files[0];
  if (!f) return;
  const fd = new FormData();
  fd.append('file', f);
  loadDataset('/api/upload', { method: 'POST', body: fd }, f.name);
});

// auto-load whatever the server already has (e.g. --load at startup)
fetch('/api/meta').then(r => r.ok ? r.json() : null).then(j => {
  if (j && j.ok) {
    clearDataset(); meta = j;
    el('loadMsg').textContent = j.name + '：' + j.totalPoints.toLocaleString() + ' 点';
    const c = new THREE.Vector3(
      (j.bboxMin[0] + j.bboxMax[0]) / 2, (j.bboxMin[1] + j.bboxMax[1]) / 2,
      (j.bboxMin[2] + j.bboxMax[2]) / 2);
    const size = Math.max(j.bboxMax[0] - j.bboxMin[0], j.bboxMax[1] - j.bboxMin[1],
                          j.bboxMax[2] - j.bboxMin[2]);
    controls.target.copy(c);
    camera.position.set(c.x + size * 0.8, c.y + size * 0.6, c.z + size * 0.8);
    camera.near = size / 10000; camera.far = size * 20;
    camera.updateProjectionMatrix();
    const z = parseFloat(new URLSearchParams(location.search).get('zoom'));
    if (z > 0) camera.position.sub(c).multiplyScalar(z).add(c);
    requestNode('r');
  }
}).catch(() => {});

// ---------- main loop ----------
const clock = new THREE.Clock();
function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.1);
  controls.update();
  if (meta) {
    pumpQueue();
    selectNodes();
    updateWeights(dt);
  }
  updateHUD(dt);
  renderer.render(scene, camera);
}
loop();
