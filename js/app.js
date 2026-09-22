import * as THREE from 'three';
import { OrbitControls } from '../vendor/OrbitControls.js';
import { computePick, checkOcclusion, boxCenter, boxSize } from './picking-core.js';

// ---------- 状态 ----------
const state = {
  parts: [],            // 含 group 节点；实体零件带 mesh / box / opaque / visible
  partById: new Map(),
  selectedId: null,
  lastCandidates: [],   // 最近一次拾取的候选（含遮挡标记）
  focusAnim: null,      // 相机聚焦动画
  occlusionDirty: true, // 视角或可见性变化后需要重算遮挡
};

// ---------- 渲染基础 ----------
const canvas = document.getElementById('viewport');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x10151c);
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 500);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.12;

scene.add(new THREE.HemisphereLight(0xffffff, 0x334455, 1.1));
const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
dirLight.position.set(6, 10, 8);
scene.add(dirLight);
const grid = new THREE.GridHelper(20, 20, 0x2a3442, 0x1c2430);
scene.add(grid);

const partRoot = new THREE.Group();
scene.add(partRoot);
const highlightBox = new THREE.Box3Helper(new THREE.Box3(), 0xffd166);
highlightBox.visible = false;
scene.add(highlightBox);

const HOME = { pos: new THREE.Vector3(9, 7, 11), target: new THREE.Vector3(0, 2, 0) };

function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== w || canvas.height !== h) {
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
}

// ---------- 模型加载 ----------
async function loadDefaultModel() {
  const resp = await fetch('data/scene.json');
  buildModel(await resp.json());
}

function buildModel(model) {
  // 清旧场景
  for (const p of state.parts) if (p.mesh) { partRoot.remove(p.mesh); p.mesh.geometry.dispose(); p.mesh.material.dispose(); }
  state.parts = [];
  state.partById.clear();
  state.selectedId = null;
  state.lastCandidates = [];

  for (const def of model.parts) {
    const part = { ...def, visible: true, mesh: null, children: [] };
    if (!part.group) {
      const size = boxSize(part.box);
      const geo = new THREE.BoxGeometry(size[0], size[1], size[2]);
      const mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(part.color || '#999999'),
        transparent: part.opaque === false,
        opacity: part.opaque === false ? 0.35 : 1.0,
        roughness: 0.6, metalness: 0.2,
      });
      const mesh = new THREE.Mesh(geo, mat);
      const c = boxCenter(part.box);
      mesh.position.set(c[0], c[1], c[2]);
      mesh.userData.partId = part.id;
      part.mesh = mesh;
      partRoot.add(mesh);
    }
    state.parts.push(part);
    state.partById.set(part.id, part);
  }
  for (const p of state.parts) {
    if (p.parentId && state.partById.has(p.parentId)) state.partById.get(p.parentId).children.push(p);
  }
  buildTree();
  refreshSelectionVisuals();
  updateOcclusionStatus();
  setStatus(`已加载模型「${model.name || '未命名'}」，共 ${state.parts.filter(p => !p.group).length} 个零件`);
}

// ---------- 层级树 ----------
function buildTree() {
  const host = document.getElementById('tree');
  host.innerHTML = '';
  const roots = state.parts.filter(p => !p.parentId || !state.partById.has(p.parentId));
  const ul = document.createElement('ul');
  for (const r of roots) ul.appendChild(treeNode(r));
  host.appendChild(ul);
}

function treeNode(part) {
  const li = document.createElement('li');
  const row = document.createElement('div');
  row.className = 'tree-row';
  row.dataset.partId = part.id;
  const caret = document.createElement('span');
  caret.className = 'caret';
  caret.textContent = part.children.length ? '▾' : '·';
  const eye = document.createElement('button');
  eye.className = 'eye';
  eye.textContent = '👁';
  eye.title = '显示 / 隐藏';
  eye.addEventListener('click', (e) => { e.stopPropagation(); setSubtreeVisible(part, !part.visible); });
  const label = document.createElement('span');
  label.textContent = part.name;
  row.append(caret, eye, label);
  if (part.opaque === false) {
    const tag = document.createElement('span');
    tag.className = 'tag'; tag.textContent = '透明';
    row.appendChild(tag);
  }
  row.addEventListener('click', () => {
    if (!part.group) { selectPart(part.id, { focus: true }); }
  });
  li.appendChild(row);
  if (part.children.length) {
    const ul = document.createElement('ul');
    for (const c of part.children) ul.appendChild(treeNode(c));
    li.appendChild(ul);
  }
  return li;
}

// ---------- 可见性切换：立即重算拾取与遮挡 ----------
function setSubtreeVisible(part, visible) {
  part.visible = visible;
  if (part.mesh) part.mesh.visible = visible;
  for (const c of part.children) setSubtreeVisible(c, visible);
  syncTreeEyes();
  // 不沿用旧结果：候选列表作废，选中遮挡状态立即重算
  state.lastCandidates = [];
  renderCandidateList();
  state.occlusionDirty = true;
  updateOcclusionStatus();
}

function syncTreeEyes() {
  document.querySelectorAll('#tree .tree-row').forEach(row => {
    const p = state.partById.get(row.dataset.partId);
    if (!p) return;
    const eye = row.querySelector('.eye');
    eye.classList.toggle('off', !p.visible);
    row.style.opacity = p.visible ? '' : '0.45';
  });
}

// ---------- 拾取 ----------
const raycaster = new THREE.Raycaster();
let downPos = null;

canvas.addEventListener('pointerdown', (e) => { downPos = [e.clientX, e.clientY]; state.focusAnim = null; });
canvas.addEventListener('pointerup', (e) => {
  if (!downPos) return;
  const moved = Math.hypot(e.clientX - downPos[0], e.clientY - downPos[1]);
  downPos = null;
  if (moved < 5 && e.button === 0) pickAt(e);
});

function pickAt(e) {
  const rect = canvas.getBoundingClientRect();
  const ndc = new THREE.Vector2(
    ((e.clientX - rect.left) / rect.width) * 2 - 1,
    -((e.clientY - rect.top) / rect.height) * 2 + 1
  );
  raycaster.setFromCamera(ndc, camera);
  const origin = raycaster.ray.origin.toArray();
  const dir = raycaster.ray.direction.toArray();
  const { selected, candidates } = computePick(state.parts, origin, dir);
  state.lastCandidates = candidates;
  if (selected) {
    selectPart(selected.part.id, { focus: false });
    const occCount = candidates.filter(c => c.occluded).length;
    setStatus(`选中「${selected.part.name}」` + (occCount ? `，另有 ${occCount} 个被挡候选（Tab 切换）` : ''));
  } else {
    selectPart(null, { focus: false });
    setStatus('该位置未命中任何零件');
  }
  renderCandidateList();
}

// Tab 在被挡候选间循环切换
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Tab' || !state.lastCandidates.length) return;
  e.preventDefault();
  const ids = state.lastCandidates.map(c => c.part.id);
  const idx = ids.indexOf(state.selectedId);
  const next = state.lastCandidates[(idx + 1) % ids.length];
  selectPart(next.part.id, { focus: false });
  setStatus(`已切换到候选「${next.part.name}」${next.occluded ? '（当前被遮挡）' : ''}`);
});

// ---------- 选中 ----------
function selectPart(id, { focus } = {}) {
  state.selectedId = id;
  refreshSelectionVisuals();
  renderPickInfo();
  if (id && focus) focusCameraOn(state.partById.get(id));
  state.occlusionDirty = true;
  updateOcclusionStatus();
}

function refreshSelectionVisuals() {
  for (const p of state.parts) {
    if (!p.mesh) continue;
    const sel = p.id === state.selectedId;
    p.mesh.material.emissive.setHex(sel ? 0x8a6d00 : 0x000000);
  }
  const sel = state.partById.get(state.selectedId);
  if (sel && sel.mesh) {
    highlightBox.box.setFromObject(sel.mesh);
    highlightBox.visible = true;
  } else {
    highlightBox.visible = false;
  }
  document.querySelectorAll('#tree .tree-row').forEach(row => {
    row.classList.toggle('selected', row.dataset.partId === state.selectedId);
  });
}

// ---------- 遮挡状态（视角转动 / 可见性变化后重算） ----------
function updateOcclusionStatus() {
  const banner = document.getElementById('occlusion-banner');
  banner.classList.add('hidden');
  document.querySelectorAll('#tree .tree-row').forEach(r => r.classList.remove('occluded-node'));
  const id = state.selectedId;
  if (!id) return;
  const res = checkOcclusion(state.parts, camera.position.toArray(), id);
  const part = state.partById.get(id);
  if (res.missing) { selectPart(null, { focus: false }); return; }
  if (res.visible) return;
  const row = document.querySelector(`#tree .tree-row[data-part-id="${id}"]`);
  if (row) row.classList.add('occluded-node');
  banner.classList.remove('hidden');
  if (res.hidden) {
    banner.innerHTML = '';
    banner.append(`「${part.name}」当前已隐藏，不参与拾取。`);
    return;
  }
  const names = res.occluders.map(o => o.name).join('、');
  banner.innerHTML = '';
  banner.append(`「${part.name}」被 ${names} 遮挡`);
  if (res.nearestVisible) {
    const btn = document.createElement('button');
    btn.textContent = `切换到可见的「${res.nearestVisible.name}」`;
    btn.addEventListener('click', () => selectPart(res.nearestVisible.id, { focus: false }));
    banner.appendChild(btn);
  }
}

// ---------- 相机平滑聚焦 ----------
function focusCameraOn(part) {
  if (!part || !part.mesh) return;
  const c = boxCenter(part.box);
  const s = boxSize(part.box);
  const radius = Math.max(s[0], s[1], s[2]);
  const dist = Math.max(radius * 2.2, 1.5);
  const dir = camera.position.clone().sub(controls.target);
  if (dir.lengthSq() < 1e-6) dir.set(1, 0.8, 1);
  dir.normalize();
  const target = new THREE.Vector3(c[0], c[1], c[2]);
  state.focusAnim = {
    t: 0, dur: 0.8,
    fromPos: camera.position.clone(), fromTarget: controls.target.clone(),
    toPos: target.clone().add(dir.multiplyScalar(dist)), toTarget: target,
  };
}

function stepFocus(dt) {
  const a = state.focusAnim;
  if (!a) return;
  a.t = Math.min(1, a.t + dt / a.dur);
  const k = a.t < 0.5 ? 2 * a.t * a.t : 1 - Math.pow(-2 * a.t + 2, 2) / 2; // easeInOut
  camera.position.lerpVectors(a.fromPos, a.toPos, k);
  controls.target.lerpVectors(a.fromTarget, a.toTarget, k);
  if (a.t >= 1) { state.focusAnim = null; state.occlusionDirty = true; }
}

// ---------- 信息面板 ----------
function renderPickInfo() {
  const host = document.getElementById('pick-info');
  const p = state.partById.get(state.selectedId);
  if (!p) { host.className = 'muted'; host.textContent = '尚未选中零件'; return; }
  host.className = '';
  const path = [];
  let cur = p;
  while (cur) { path.unshift(cur.name); cur = state.partById.get(cur.parentId); }
  host.innerHTML = '';
  const el = document.createElement('div');
  el.style.padding = '0 10px';
  el.innerHTML = `<div><b>${p.name}</b></div>` +
    `<div class="muted">层级：${path.join(' / ')}</div>` +
    `<div class="muted">id：${p.id}　${p.opaque === false ? '透明' : '不透明'}</div>`;
  host.appendChild(el);
}

function renderCandidateList() {
  const ul = document.getElementById('candidate-list');
  ul.innerHTML = '';
  if (!state.lastCandidates.length) {
    const li = document.createElement('li');
    li.className = 'muted';
    li.textContent = '（点击场景后显示）';
    ul.appendChild(li);
    return;
  }
  for (const c of state.lastCandidates) {
    const li = document.createElement('li');
    const occNames = c.occluders.map(id => (state.partById.get(id) || {}).name).join('、');
    const label = document.createElement('span');
    label.textContent = `${c.part.name}（t=${c.t.toFixed(2)}）`;
    if (c.occluded) {
      label.className = 'occ';
      label.textContent += ` — 被 ${occNames} 挡住`;
    }
    const btn = document.createElement('button');
    btn.textContent = '选中';
    btn.addEventListener('click', () => selectPart(c.part.id, { focus: false }));
    li.append(label, btn);
    ul.appendChild(li);
  }
}

function setStatus(msg) { document.getElementById('status').textContent = msg; }

// ---------- 工具栏 ----------
document.getElementById('btn-reset-view').addEventListener('click', () => {
  state.focusAnim = {
    t: 0, dur: 0.8,
    fromPos: camera.position.clone(), fromTarget: controls.target.clone(),
    toPos: HOME.pos.clone(), toTarget: HOME.target.clone(),
  };
});
document.getElementById('btn-load').addEventListener('click', () => document.getElementById('file-input').click());
document.getElementById('file-input').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    buildModel(JSON.parse(await f.text()));
  } catch (err) {
    setStatus(`模型加载失败：${err.message}`);
  }
  e.target.value = '';
});

// ---------- 主循环 ----------
controls.addEventListener('change', () => { state.occlusionDirty = true; });
const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.1);
  stepFocus(dt);
  controls.update();
  if (state.occlusionDirty) {
    state.occlusionDirty = false;
    updateOcclusionStatus();
  }
  resize();
  renderer.render(scene, camera);
}

camera.position.copy(HOME.pos);
controls.target.copy(HOME.target);
loadDefaultModel().catch(err => setStatus(`默认模型加载失败：${err.message}`));
animate();
