import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Molecule, MOLECULE_DATA, ELEMENT_NAMES } from './Molecule';
import { MoleculeRenderer, Measurement } from './MoleculeRenderer';

let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let renderer: THREE.WebGLRenderer;
let controls: OrbitControls;
let molecule: Molecule | null = null;
let moleculeRenderer: MoleculeRenderer;
let container: HTMLElement;
let atomLabelEl: HTMLElement;

let measureMode = false;
let selectedAtoms: number[] = [];
let measurements: Measurement[] = [];
let measurementIdCounter = 0;

let autoRotate = false;
let autoRotateSpeed = 1.0;

let isTransitioning = false;
let labelTimeout: number | null = null;
let specularLight: THREE.PointLight | null = null;
let lightAngle = 0;

const ANGSTROM_SCALE = 1.0;

function init() {
  container = document.getElementById('canvas-container')!;
  atomLabelEl = document.getElementById('atom-label')!;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1a2e);

  const width = container.clientWidth;
  const height = container.clientHeight;

  camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 1000);
  camera.position.set(0, 0, 5);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(width, height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.minDistance = 1;
  controls.maxDistance = 15;
  controls.enablePan = false;

  moleculeRenderer = new MoleculeRenderer(scene, camera, renderer, container);

  setupLights();
  loadMolecule('water');
  setupEventListeners();
  animate();
}

function setupLights() {
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
  scene.add(ambientLight);

  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.6);
  directionalLight.position.set(5, 5, 5);
  directionalLight.castShadow = true;
  scene.add(directionalLight);

  const pointLight1 = new THREE.PointLight(0x64b5f6, 0.3, 20);
  pointLight1.position.set(-3, 3, 3);
  scene.add(pointLight1);

  const pointLight2 = new THREE.PointLight(0xff9800, 0.2, 20);
  pointLight2.position.set(3, -3, -3);
  scene.add(pointLight2);

  specularLight = new THREE.PointLight(0xffffff, 0.8, 10);
  specularLight.position.set(2, 2, 3);
  scene.add(specularLight);
}

function loadMolecule(name: string) {
  if (isTransitioning) return;
  
  const data = MOLECULE_DATA[name];
  if (!data) return;

  if (molecule) {
    scene.remove(molecule.group);
    molecule.dispose();
    molecule = null;
  }

  clearAllMeasurements();
  selectedAtoms = [];

  molecule = new Molecule(data);
  scene.add(molecule.group);

  adjustCamera();

  molecule.group.scale.set(0.1, 0.1, 0.1);
  molecule.group.rotation.y = Math.PI;
  isTransitioning = true;

  const startTime = performance.now();
  const duration = 800;

  function animateTransition(currentTime: number) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);
    
    const easeProgress = easeInOutCubic(progress);
    const scale = 0.1 + easeProgress * 0.9;
    const rotation = Math.PI - easeProgress * Math.PI;
    
    if (molecule) {
      molecule.group.scale.set(scale, scale, scale);
      molecule.group.rotation.y = rotation;
    }

    if (progress < 1) {
      requestAnimationFrame(animateTransition);
    } else {
      isTransitioning = false;
      if (molecule) {
        molecule.group.rotation.y = 0;
        molecule.group.scale.set(1, 1, 1);
      }
    }
  }

  requestAnimationFrame(animateTransition);
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function adjustCamera() {
  if (!molecule) return;
  
  const box = new THREE.Box3().setFromObject(molecule.group);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  
  const maxDim = Math.max(size.x, size.y, size.z) * 2;
  const fov = camera.fov * (Math.PI / 180);
  let cameraZ = Math.abs(maxDim / (2 * Math.tan(fov / 2)));
  cameraZ *= 1.8;
  
  camera.position.set(center.x, center.y, center.z + cameraZ);
  controls.target.copy(center);
  controls.update();
  
  controls.minDistance = cameraZ * 0.3;
  controls.maxDistance = cameraZ * 5;
}

function setupEventListeners() {
  window.addEventListener('resize', onWindowResize);
  
  renderer.domElement.addEventListener('mousemove', onMouseMove);
  renderer.domElement.addEventListener('dblclick', onDoubleClick);
  renderer.domElement.addEventListener('click', onClick);

  const moleculeSelect = document.getElementById('molecule-select') as HTMLSelectElement;
  moleculeSelect.addEventListener('change', (e) => {
    loadMolecule((e.target as HTMLSelectElement).value);
  });

  const measureModeBtn = document.getElementById('measure-mode-btn') as HTMLButtonElement;
  measureModeBtn.addEventListener('click', () => {
    measureMode = !measureMode;
    measureModeBtn.classList.toggle('active', measureMode);
    measureModeBtn.querySelector('span')!.textContent = measureMode ? '关闭测量' : '开启测量';
    if (!measureMode) {
      selectedAtoms = [];
    }
  });

  const autoRotateBtn = document.getElementById('auto-rotate-btn') as HTMLButtonElement;
  autoRotateBtn.addEventListener('click', () => {
    autoRotate = !autoRotate;
    autoRotateBtn.classList.toggle('active', autoRotate);
    autoRotateBtn.querySelector('span')!.textContent = autoRotate ? '关闭旋转' : '开启旋转';
  });

  const speedSlider = document.getElementById('speed-slider') as HTMLInputElement;
  const speedValue = document.getElementById('speed-value') as HTMLElement;
  speedSlider.addEventListener('input', (e) => {
    autoRotateSpeed = parseFloat((e.target as HTMLInputElement).value);
    speedValue.textContent = `${autoRotateSpeed.toFixed(1)} 转/分钟`;
  });

  const mobileToggle = document.getElementById('mobile-toggle') as HTMLButtonElement;
  const controlPanel = document.getElementById('control-panel') as HTMLElement;
  mobileToggle.addEventListener('click', () => {
    controlPanel.classList.toggle('open');
    mobileToggle.textContent = controlPanel.classList.contains('open') ? '收起面板' : '控制面板';
  });
}

function onWindowResize() {
  const width = container.clientWidth;
  const height = container.clientHeight;
  
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
}

function onMouseMove(event: MouseEvent) {
  if (!molecule || isTransitioning) return;

  moleculeRenderer.updateMouse(event.clientX, event.clientY);
  const intersected = moleculeRenderer.getIntersectedAtom(molecule.getAtomMeshes());
  
  moleculeRenderer.highlightAtom(intersected);
  
  renderer.domElement.style.cursor = intersected ? 'pointer' : 'grab';
}

function onDoubleClick(event: MouseEvent) {
  if (!molecule || isTransitioning) return;

  moleculeRenderer.updateMouse(event.clientX, event.clientY);
  const intersected = moleculeRenderer.getIntersectedAtom(molecule.getAtomMeshes());
  
  if (intersected) {
    const atomIndex = intersected.userData.atomIndex;
    showAtomLabel(atomIndex, event.clientX, event.clientY);
  }
}

function showAtomLabel(atomIndex: number, clientX: number, clientY: number) {
  if (!molecule) return;

  const element = molecule.getAtomElement(atomIndex);
  const elementName = ELEMENT_NAMES[element] || element;
  const bondedAtoms = molecule.getBondedAtoms(atomIndex);

  const labelElement = document.getElementById('label-element')!;
  const labelIndex = document.getElementById('label-index')!;
  const labelDistance = document.getElementById('label-distance')!;

  labelElement.textContent = `${elementName} (${element})`;
  labelIndex.textContent = `原子索引: ${atomIndex}`;
  
  let distanceText = '相邻原子:';
  if (bondedAtoms.length === 0) {
    distanceText += ' 无';
  } else {
    distanceText += '<br/>';
    bondedAtoms.forEach((bondedIdx, i) => {
      const dist = molecule!.getDistance(atomIndex, bondedIdx);
      const bondedElement = molecule!.getAtomElement(bondedIdx);
      distanceText += `  ${bondedElement}${bondedIdx}: ${dist.toFixed(3)} Å`;
      if (i < bondedAtoms.length - 1) distanceText += '<br/>';
    });
  }
  labelDistance.innerHTML = distanceText;

  const rect = container.getBoundingClientRect();
  let left = clientX - rect.left + 15;
  let top = clientY - rect.top + 15;
  
  const labelWidth = 180;
  const labelHeight = 100;
  
  if (left + labelWidth > rect.width) {
    left = clientX - rect.left - labelWidth - 15;
  }
  if (top + labelHeight > rect.height) {
    top = clientY - rect.top - labelHeight - 15;
  }

  atomLabelEl.style.left = `${left}px`;
  atomLabelEl.style.top = `${top}px`;
  atomLabelEl.classList.add('visible');

  if (labelTimeout) {
    clearTimeout(labelTimeout);
  }
  labelTimeout = window.setTimeout(() => {
    atomLabelEl.classList.remove('visible');
  }, 2000);
}

function onClick(event: MouseEvent) {
  if (!molecule || !measureMode || isTransitioning) return;

  moleculeRenderer.updateMouse(event.clientX, event.clientY);
  const intersected = moleculeRenderer.getIntersectedAtom(molecule.getAtomMeshes());
  
  if (intersected) {
    const atomIndex = intersected.userData.atomIndex;
    
    if (selectedAtoms.includes(atomIndex)) {
      selectedAtoms = selectedAtoms.filter((i) => i !== atomIndex);
      return;
    }
    
    selectedAtoms.push(atomIndex);
    
    if (selectedAtoms.length === 2) {
      addDistanceMeasurement(selectedAtoms[0], selectedAtoms[1]);
    } else if (selectedAtoms.length === 3) {
      addAngleMeasurement(selectedAtoms[0], selectedAtoms[1], selectedAtoms[2]);
      selectedAtoms = [];
    }
  }
}

function addDistanceMeasurement(atom1Idx: number, atom2Idx: number) {
  if (!molecule) return;

  const dist = molecule.getDistance(atom1Idx, atom2Idx);
  const pos1 = molecule.getAtomWorldPosition(atom1Idx);
  const pos2 = molecule.getAtomWorldPosition(atom2Idx);
  const el1 = molecule.getAtomElement(atom1Idx);
  const el2 = molecule.getAtomElement(atom2Idx);

  const measurement = moleculeRenderer.addDistanceMeasurement(pos1, pos2, dist);
  measurement.atomIndices = [atom1Idx, atom2Idx];
  
  measurements.push(measurement);
  updateMeasurementsList();
}

function addAngleMeasurement(atom1Idx: number, centerIdx: number, atom2Idx: number) {
  if (!molecule) return;

  const angle = molecule.getBondAngle(atom1Idx, centerIdx, atom2Idx);
  const pos1 = molecule.getAtomWorldPosition(atom1Idx);
  const centerPos = molecule.getAtomWorldPosition(centerIdx);
  const pos2 = molecule.getAtomWorldPosition(atom2Idx);
  const dist1 = molecule.getDistance(atom1Idx, centerIdx);
  const dist2 = molecule.getDistance(centerIdx, atom2Idx);

  const measurement = moleculeRenderer.addAngleMeasurement(
    pos1, centerPos, pos2, angle, dist1, dist2
  );
  measurement.atomIndices = [atom1Idx, centerIdx, atom2Idx];
  
  measurements.push(measurement);
  updateMeasurementsList();
}

function updateMeasurementsList() {
  const listEl = document.getElementById('measurements-list') as HTMLElement;
  
  if (measurements.length === 0) {
    listEl.innerHTML = '<div style="font-size: 12px; color: #777; text-align: center; padding: 10px;">暂无测量数据</div>';
    return;
  }

  listEl.innerHTML = '';
  
  measurements.forEach((m) => {
    const item = document.createElement('div');
    item.className = 'measurement-item';
    
    const info = document.createElement('div');
    info.className = 'measurement-info';
    
    const typeEl = document.createElement('div');
    typeEl.className = 'measurement-type';
    
    const valueEl = document.createElement('div');
    valueEl.className = 'measurement-value';
    
    if (m.type === 'distance') {
      typeEl.textContent = `距离 ${getAtomSymbols(m.atomIndices)}`;
      valueEl.textContent = `${m.value.toFixed(2)} Å`;
    } else {
      typeEl.textContent = `键角 ${getAtomSymbols(m.atomIndices)}`;
      valueEl.textContent = `${m.value.toFixed(2)}°`;
    }
    
    info.appendChild(typeEl);
    info.appendChild(valueEl);
    
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete-btn';
    deleteBtn.textContent = '删除';
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      removeMeasurement(m.id);
    });
    
    item.appendChild(info);
    item.appendChild(deleteBtn);
    listEl.appendChild(item);
  });
}

function getAtomSymbols(indices: number[]): string {
  if (!molecule) return '';
  return indices.map((i) => molecule!.getAtomElement(i) + i).join('-');
}

function removeMeasurement(id: number) {
  moleculeRenderer.removeMeasurement(id);
  measurements = measurements.filter((m) => m.id !== id);
  updateMeasurementsList();
}

function clearAllMeasurements() {
  moleculeRenderer.clearMeasurements();
  measurements = [];
  updateMeasurementsList();
}

function animate() {
  requestAnimationFrame(animate);
  
  if (autoRotate && molecule && !isTransitioning) {
    const angularVelocity = (autoRotateSpeed * 2 * Math.PI) / 60;
    molecule.group.rotation.y += angularVelocity / 60;
    
    if (specularLight && molecule) {
      lightAngle += angularVelocity / 60 * 0.5;
      const radius = 3;
      specularLight.position.x = Math.cos(lightAngle) * radius;
      specularLight.position.z = Math.sin(lightAngle) * radius;
    }
  }
  
  controls.update();
  renderer.render(scene, camera);
}

document.addEventListener('DOMContentLoaded', init);
