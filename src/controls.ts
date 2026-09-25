import { NebulaParams } from './nebula';

export type ControlChangeHandler = (params: NebulaParams) => void;

interface SliderConfig {
  key: keyof NebulaParams;
  label: string;
  min: number;
  max: number;
  step: number;
  unit: string;
  format: (value: number) => string;
}

const sliderConfigs: SliderConfig[] = [
  {
    key: 'particleCount',
    label: '粒子数量',
    min: 1000,
    max: 10000,
    step: 500,
    unit: '',
    format: (v) => v.toFixed(0)
  },
  {
    key: 'hueOffset',
    label: '色相偏移',
    min: 0,
    max: 360,
    step: 1,
    unit: '°',
    format: (v) => v.toFixed(0)
  },
  {
    key: 'radius',
    label: '扩散半径',
    min: 5,
    max: 20,
    step: 0.5,
    unit: '',
    format: (v) => v.toFixed(1)
  },
  {
    key: 'rotationSpeed',
    label: '旋转速度',
    min: 0,
    max: 2,
    step: 0.05,
    unit: ' rad/s',
    format: (v) => v.toFixed(2)
  }
];

export function createControls(
  container: HTMLElement,
  initialParams: NebulaParams,
  onChange: ControlChangeHandler
): void {
  const currentParams: NebulaParams = { ...initialParams };
  let pendingUpdate = false;

  const title = document.createElement('div');
  title.className = 'panel-title';
  title.textContent = '✨ 星云参数控制';
  container.appendChild(title);

  sliderConfigs.forEach((config) => {
    const group = document.createElement('div');
    group.className = 'control-group';

    const labelRow = document.createElement('div');
    labelRow.className = 'control-label';

    const labelText = document.createElement('span');
    labelText.textContent = config.label;

    const valueDisplay = document.createElement('span');
    valueDisplay.className = 'control-value';
    valueDisplay.textContent = config.format(currentParams[config.key] as number) + config.unit;

    labelRow.appendChild(labelText);
    labelRow.appendChild(valueDisplay);

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = config.min.toString();
    slider.max = config.max.toString();
    slider.step = config.step.toString();
    slider.value = (currentParams[config.key] as number).toString();

    const triggerUpdate = () => {
      if (!pendingUpdate) {
        pendingUpdate = true;
        requestAnimationFrame(() => {
          onChange({ ...currentParams });
          pendingUpdate = false;
        });
      }
    };

    slider.addEventListener('input', (e) => {
      const value = parseFloat((e.target as HTMLInputElement).value);
      (currentParams[config.key] as number) = value;
      valueDisplay.textContent = config.format(value) + config.unit;
      triggerUpdate();
    });

    slider.addEventListener('change', (e) => {
      const value = parseFloat((e.target as HTMLInputElement).value);
      (currentParams[config.key] as number) = value;
      valueDisplay.textContent = config.format(value) + config.unit;
      onChange({ ...currentParams });
    });

    group.appendChild(labelRow);
    group.appendChild(slider);
    container.appendChild(group);
  });
}
