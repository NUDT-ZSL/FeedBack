export interface UIState {
  speed: number;
  showOrbits: boolean;
  selectedPlanet: string;
}

export interface UIController {
  container: HTMLElement;
  state: UIState;
  onSpeedChange: (cb: (speed: number) => void) => void;
  onOrbitToggle: (cb: (show: boolean) => void) => void;
  onFocus: (cb: (planetName: string) => void) => void;
  updatePlanetOptions: (planets: string[]) => void;
  updateFPS: (fps: number) => void;
}

type SpeedCallback = (speed: number) => void;
type OrbitCallback = (show: boolean) => void;
type FocusCallback = (planetName: string) => void;

export function createUI(container: HTMLElement): UIController {
  const state: UIState = {
    speed: 1.0,
    showOrbits: true,
    selectedPlanet: ''
  };

  let speedCallbacks: SpeedCallback[] = [];
  let orbitCallbacks: OrbitCallback[] = [];
  let focusCallbacks: FocusCallback[] = [];

  const panel = document.createElement('div');
  panel.className = 'control-panel';

  const panelToggle = document.createElement('button');
  panelToggle.className = 'panel-toggle';
  panelToggle.innerHTML = '☰';
  panelToggle.addEventListener('click', () => {
    panel.classList.toggle('mobile-open');
  });

  const title = document.createElement('div');
  title.className = 'panel-title';
  title.textContent = '太阳系控制台';
  panel.appendChild(title);

  const speedGroup = document.createElement('div');
  speedGroup.className = 'control-group';
  const speedLabel = document.createElement('label');
  speedLabel.className = 'control-label';
  speedLabel.textContent = '运行速度';
  const sliderContainer = document.createElement('div');
  sliderContainer.className = 'slider-container';
  const speedValue = document.createElement('span');
  speedValue.className = 'speed-value';
  speedValue.textContent = '1.0x';
  const speedSlider = document.createElement('input');
  speedSlider.type = 'range';
  speedSlider.min = '0.5';
  speedSlider.max = '5';
  speedSlider.step = '0.1';
  speedSlider.value = '1';
  speedSlider.className = 'speed-slider';

  speedSlider.addEventListener('input', (e) => {
    const value = parseFloat((e.target as HTMLInputElement).value);
    state.speed = value;
    speedValue.textContent = `${value.toFixed(1)}x`;
    speedCallbacks.forEach(cb => cb(value));
  });

  sliderContainer.appendChild(speedValue);
  sliderContainer.appendChild(speedSlider);
  speedGroup.appendChild(speedLabel);
  speedGroup.appendChild(sliderContainer);
  panel.appendChild(speedGroup);

  const orbitGroup = document.createElement('div');
  orbitGroup.className = 'control-group';
  const orbitLabel = document.createElement('label');
  orbitLabel.className = 'control-label';
  orbitLabel.textContent = '显示轨道环';
  const toggleContainer = document.createElement('div');
  toggleContainer.className = 'toggle-container';
  const orbitSwitch = document.createElement('div');
  orbitSwitch.className = 'toggle-switch active';
  orbitSwitch.addEventListener('click', () => {
    state.showOrbits = !state.showOrbits;
    orbitSwitch.classList.toggle('active', state.showOrbits);
    orbitCallbacks.forEach(cb => cb(state.showOrbits));
  });
  toggleContainer.appendChild(orbitLabel);
  toggleContainer.appendChild(orbitSwitch);
  orbitGroup.appendChild(toggleContainer);
  panel.appendChild(orbitGroup);

  const focusGroup = document.createElement('div');
  focusGroup.className = 'control-group';
  const focusLabel = document.createElement('label');
  focusLabel.className = 'control-label';
  focusLabel.textContent = '选择行星';
  const planetSelect = document.createElement('select');
  planetSelect.className = 'planet-select';
  planetSelect.addEventListener('change', (e) => {
    state.selectedPlanet = (e.target as HTMLSelectElement).value;
  });
  focusGroup.appendChild(focusLabel);
  focusGroup.appendChild(planetSelect);
  panel.appendChild(focusGroup);

  const focusBtn = document.createElement('button');
  focusBtn.className = 'btn btn-primary';
  focusBtn.textContent = '聚焦行星';
  focusBtn.addEventListener('click', () => {
    if (state.selectedPlanet) {
      focusCallbacks.forEach(cb => cb(state.selectedPlanet));
    }
  });
  panel.appendChild(focusBtn);

  const fpsCounter = document.createElement('div');
  fpsCounter.className = 'fps-counter';
  fpsCounter.textContent = 'FPS: --';

  container.appendChild(panelToggle);
  container.appendChild(panel);
  container.appendChild(fpsCounter);

  function updatePlanetOptions(planets: string[]) {
    planetSelect.innerHTML = '';
    const defaultOption = document.createElement('option');
    defaultOption.value = '';
    defaultOption.textContent = '--- 请选择 ---';
    planetSelect.appendChild(defaultOption);
    
    planets.forEach(name => {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      planetSelect.appendChild(option);
    });
  }

  function updateFPS(fps: number) {
    fpsCounter.textContent = `FPS: ${fps.toFixed(0)}`;
  }

  return {
    container,
    state,
    onSpeedChange: (cb: SpeedCallback) => speedCallbacks.push(cb),
    onOrbitToggle: (cb: OrbitCallback) => orbitCallbacks.push(cb),
    onFocus: (cb: FocusCallback) => focusCallbacks.push(cb),
    updatePlanetOptions,
    updateFPS
  };
}
