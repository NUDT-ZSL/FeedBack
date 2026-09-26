import type { Artwork } from './gallery';
import * as THREE from 'three';

export interface UICallbacks {
  onThumbnailClick?: (index: number) => void;
  onJoystickMove?: (dx: number, dy: number) => void;
  onInfoPanelClose?: () => void;
}

export interface UI {
  container: HTMLElement;
  setThumbnails: (artworks: Artwork[]) => void;
  setFocusedArtwork: (artwork: Artwork | null) => void;
  updateDistance: (distance: number) => void;
  showInfoPanel: (artwork: Artwork) => void;
  hideInfoPanel: () => void;
  joystickActive: boolean;
  getJoystickVector: () => { x: number; y: number };
}

function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function animateValue(start: number, end: number, duration: number, callback: (v: number) => void): void {
  const startTime = performance.now();
  function step(now: number): void {
    const elapsed = now - startTime;
    const t = Math.min(1, elapsed / duration);
    const eased = easeOut(t);
    callback(start + (end - start) * eased);
    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

export function createUI(root: HTMLElement, callbacks: UICallbacks = {}): UI {
  const container = document.createElement('div');
  container.style.cssText = `
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: 10;
    overflow: hidden;
  `;
  root.appendChild(container);

  const distanceDisplay = document.createElement('div');
  distanceDisplay.style.cssText = `
    position: absolute;
    top: 20px;
    right: 24px;
    color: #F0F0F0;
    font-size: 14px;
    font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
    text-shadow: 0 2px 8px rgba(0, 0, 0, 0.8), 0 0 12px rgba(197, 163, 90, 0.3);
    letter-spacing: 0.5px;
    padding: 8px 14px;
    background: rgba(20, 20, 25, 0.4);
    border-radius: 6px;
    border: 1px solid rgba(197, 163, 90, 0.2);
    backdrop-filter: blur(6px);
    -webkit-backdrop-filter: blur(6px);
    transition: all 0.3s ease-out;
    pointer-events: none;
  `;
  distanceDisplay.textContent = '距离最近画作: --';
  container.appendChild(distanceDisplay);

  const thumbContainer = document.createElement('div');
  thumbContainer.style.cssText = `
    position: absolute;
    top: 20px;
    left: 20px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    pointer-events: none;
  `;
  container.appendChild(thumbContainer);

  const thumbScroll = document.createElement('div');
  thumbScroll.style.cssText = `
    display: flex;
    gap: 10px;
    padding: 10px 12px;
    background: rgba(20, 20, 25, 0.45);
    border-radius: 12px;
    border: 1px solid rgba(197, 163, 90, 0.2);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    overflow-x: auto;
    overflow-y: hidden;
    max-width: calc(100vw - 40px);
    scrollbar-width: thin;
    scrollbar-color: rgba(197, 163, 90, 0.4) transparent;
    pointer-events: auto;
    transition: all 0.3s ease-out;
  `;
  thumbScroll.style.setProperty('max-width', 'min(720px, calc(100vw - 240px))');
  thumbContainer.appendChild(thumbScroll);

  const scrollStyle = document.createElement('style');
  scrollStyle.textContent = `
    #thumbScroll::-webkit-scrollbar {
      height: 4px;
    }
    #thumbScroll::-webkit-scrollbar-track {
      background: transparent;
    }
    #thumbScroll::-webkit-scrollbar-thumb {
      background: rgba(197, 163, 90, 0.3);
      border-radius: 2px;
    }
  `;
  document.head.appendChild(scrollStyle);

  const infoBubble = document.createElement('div');
  infoBubble.style.cssText = `
    align-self: flex-start;
    max-width: 560px;
    padding: 12px 16px;
    background: rgba(255, 255, 255, 0.15);
    border-radius: 8px;
    border: 1px solid rgba(197, 163, 90, 0.25);
    backdrop-filter: blur(6px);
    -webkit-backdrop-filter: blur(6px);
    color: #E0E0E0;
    font-size: 12px;
    font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
    line-height: 1.6;
    opacity: 0;
    transform: translateY(-8px);
    transition: all 0.3s ease-out;
    pointer-events: none;
  `;
  infoBubble.textContent = '点击左侧缩略图可快速传送到对应画作';
  thumbContainer.appendChild(infoBubble);

  const joystickBase = document.createElement('div');
  const joystickSize = 120;
  const knobSize = 50;
  joystickBase.style.cssText = `
    position: absolute;
    bottom: 32px;
    left: 32px;
    width: ${joystickSize}px;
    height: ${joystickSize}px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(197, 163, 90, 0.3);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    touch-action: none;
    pointer-events: auto;
    user-select: none;
    transition: all 0.3s ease-out;
    opacity: 0.8;
  `;
  container.appendChild(joystickBase);

  const crossArrows = document.createElement('div');
  crossArrows.style.cssText = `
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 70%;
    height: 70%;
    pointer-events: none;
    opacity: 0.5;
  `;
  crossArrows.innerHTML = `
    <svg viewBox="0 0 100 100" width="100%" height="100%">
      <line x1="50" y1="10" x2="50" y2="40" stroke="white" stroke-width="2.5" stroke-linecap="round"/>
      <line x1="50" y1="60" x2="50" y2="90" stroke="white" stroke-width="2.5" stroke-linecap="round"/>
      <line x1="10" y1="50" x2="40" y2="50" stroke="white" stroke-width="2.5" stroke-linecap="round"/>
      <line x1="60" y1="50" x2="90" y2="50" stroke="white" stroke-width="2.5" stroke-linecap="round"/>
      <polygon points="50,5 43,18 57,18" fill="white"/>
      <polygon points="50,95 43,82 57,82" fill="white"/>
      <polygon points="5,50 18,43 18,57" fill="white"/>
      <polygon points="95,50 82,43 82,57" fill="white"/>
    </svg>
  `;
  joystickBase.appendChild(crossArrows);

  const joystickKnob = document.createElement('div');
  joystickKnob.style.cssText = `
    position: absolute;
    top: 50%;
    left: 50%;
    width: ${knobSize}px;
    height: ${knobSize}px;
    border-radius: 50%;
    background: linear-gradient(135deg, rgba(197, 163, 90, 0.9), rgba(160, 120, 60, 0.9));
    border: 2px solid rgba(255, 240, 200, 0.4);
    box-shadow: 0 0 16px rgba(197, 163, 90, 0.5), inset 0 2px 4px rgba(255, 255, 255, 0.3);
    transform: translate(-50%, -50%);
    pointer-events: none;
    transition: transform 0.1s ease-out;
  `;
  joystickBase.appendChild(joystickKnob);

  let joystickActive = false;
  let joystickVector = { x: 0, y: 0 };

  function handleJoystickStart(clientX: number, clientY: number): void {
    joystickActive = true;
    joystickBase.style.opacity = '1';
    (joystickBase.style as any).transform = 'scale(1.05)';
    handleJoystickMove(clientX, clientY);
  }

  function handleJoystickMove(clientX: number, clientY: number): void {
    if (!joystickActive) return;
    const rect = joystickBase.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    let dx = clientX - centerX;
    let dy = clientY - centerY;
    const maxDist = (joystickSize - knobSize) / 2;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > maxDist) {
      dx = (dx / dist) * maxDist;
      dy = (dy / dist) * maxDist;
    }
    joystickKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    joystickVector = {
      x: dx / maxDist,
      y: dy / maxDist
    };
    if (callbacks.onJoystickMove) {
      callbacks.onJoystickMove(joystickVector.x, joystickVector.y);
    }
  }

  function handleJoystickEnd(): void {
    joystickActive = false;
    joystickVector = { x: 0, y: 0 };
    joystickBase.style.opacity = '0.8';
    (joystickBase.style as any).transform = 'scale(1)';
    animateValue(joystickKnob.offsetLeft, 0, 0.15, () => {});
    joystickKnob.style.transform = 'translate(-50%, -50%)';
    if (callbacks.onJoystickMove) {
      callbacks.onJoystickMove(0, 0);
    }
  }

  joystickBase.addEventListener('mousedown', (e) => {
    e.preventDefault();
    handleJoystickStart(e.clientX, e.clientY);
    const onMove = (ev: MouseEvent) => handleJoystickMove(ev.clientX, ev.clientY);
    const onUp = () => {
      handleJoystickEnd();
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  joystickBase.addEventListener('touchstart', (e) => {
    e.preventDefault();
    const t = e.touches[0];
    handleJoystickStart(t.clientX, t.clientY);
  }, { passive: false });

  joystickBase.addEventListener('touchmove', (e) => {
    e.preventDefault();
    const t = e.touches[0];
    handleJoystickMove(t.clientX, t.clientY);
  }, { passive: false });

  joystickBase.addEventListener('touchend', (e) => {
    e.preventDefault();
    handleJoystickEnd();
  }, { passive: false });

  joystickBase.addEventListener('touchcancel', (e) => {
    e.preventDefault();
    handleJoystickEnd();
  }, { passive: false });

  const infoPanel = document.createElement('div');
  infoPanel.style.cssText = `
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%) scale(0.9);
    width: min(480px, 90vw);
    padding: 0;
    background: rgba(22, 22, 28, 0.92);
    border-radius: 16px;
    border: 1px solid rgba(197, 163, 90, 0.35);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6), 0 0 40px rgba(197, 163, 90, 0.1);
    opacity: 0;
    pointer-events: none;
    transition: all 0.3s ease-out;
    overflow: hidden;
  `;
  container.appendChild(infoPanel);

  let currentThumbIndex = -1;
  const thumbButtons: HTMLDivElement[] = [];

  function setThumbnails(artworks: Artwork[]): void {
    thumbScroll.innerHTML = '';
    thumbButtons.length = 0;
    artworks.forEach((art, index) => {
      const wrapper = document.createElement('div');
      wrapper.style.cssText = `
        flex-shrink: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 6px;
        cursor: pointer;
        pointer-events: auto;
        transition: all 0.3s ease-out;
      `;

      const btn = document.createElement('div');
      btn.style.cssText = `
        width: 50px;
        height: 50px;
        border-radius: 50%;
        overflow: hidden;
        border: 2px solid rgba(255, 255, 255, 0.6);
        background: #111;
        transition: all 0.3s ease-out;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
      `;

      const canvas = document.createElement('canvas');
      canvas.width = 50;
      canvas.height = 50;
      const ctx = canvas.getContext('2d')!;
      const srcCanvas = art.painting.material instanceof THREE.MeshStandardMaterial &&
        (art.painting.material.map as any)?.image as HTMLCanvasElement;
      if (srcCanvas) {
        const scale = Math.max(50 / srcCanvas.width, 50 / srcCanvas.height);
        const sw = 50 / scale;
        const sh = 50 / scale;
        const sx = (srcCanvas.width - sw) / 2;
        const sy = (srcCanvas.height - sh) / 2;
        ctx.save();
        ctx.beginPath();
        ctx.arc(25, 25, 25, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(srcCanvas, sx, sy, sw, sh, 0, 0, 50, 50);
        ctx.restore();
      }
      btn.appendChild(canvas);

      const label = document.createElement('div');
      label.style.cssText = `
        font-size: 10px;
        color: rgba(224, 224, 224, 0.7);
        font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
        white-space: nowrap;
        max-width: 60px;
        overflow: hidden;
        text-overflow: ellipsis;
      `;
      label.textContent = art.title;

      wrapper.appendChild(btn);
      wrapper.appendChild(label);

      wrapper.addEventListener('click', () => {
        if (callbacks.onThumbnailClick) {
          callbacks.onThumbnailClick(index);
        }
      });

      wrapper.addEventListener('mouseenter', () => {
        btn.style.transform = 'scale(1.1)';
        btn.style.borderColor = '#C5A35A';
        btn.style.boxShadow = '0 4px 16px rgba(197, 163, 90, 0.4)';
      });
      wrapper.addEventListener('mouseleave', () => {
        if (index !== currentThumbIndex) {
          btn.style.transform = 'scale(1)';
          btn.style.borderColor = 'rgba(255, 255, 255, 0.6)';
          btn.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.4)';
        }
      });

      thumbScroll.appendChild(wrapper);
      thumbButtons.push(btn);
    });
  }

  function setFocusedArtwork(artwork: Artwork | null): void {
    const index = artwork ? artwork.id : -1;

    thumbButtons.forEach((btn, i) => {
      if (i === index) {
        btn.style.borderColor = '#C5A35A';
        btn.style.borderWidth = '3px';
        btn.style.boxShadow = '0 0 20px rgba(197, 163, 90, 0.6), 0 4px 12px rgba(0, 0, 0, 0.5)';
        btn.style.transform = 'scale(1.15)';
      } else {
        btn.style.borderColor = 'rgba(255, 255, 255, 0.6)';
        btn.style.borderWidth = '2px';
        btn.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.4)';
        btn.style.transform = 'scale(1)';
      }
    });

    currentThumbIndex = index;

    if (artwork) {
      infoBubble.textContent = `《${artwork.title}》— ${artwork.author}\n${artwork.description}`;
      infoBubble.style.whiteSpace = 'pre-wrap';
      infoBubble.style.opacity = '1';
      infoBubble.style.transform = 'translateY(0)';
    } else {
      infoBubble.textContent = '使用 WASD 或左下角摇杆移动，拖拽鼠标旋转视角，点击画作查看详情';
      infoBubble.style.whiteSpace = 'normal';
      infoBubble.style.opacity = '1';
      infoBubble.style.transform = 'translateY(0)';
    }
  }

  function updateDistance(distance: number): void {
    const d = Math.round(distance * 100) / 100;
    distanceDisplay.textContent = `距离最近画作: ${d.toFixed(2)} 单位`;
    if (distance < 2) {
      distanceDisplay.style.background = 'rgba(197, 163, 90, 0.2)';
      distanceDisplay.style.borderColor = 'rgba(197, 163, 90, 0.5)';
    } else {
      distanceDisplay.style.background = 'rgba(20, 20, 25, 0.4)';
      distanceDisplay.style.borderColor = 'rgba(197, 163, 90, 0.2)';
    }
  }

  function showInfoPanel(artwork: Artwork): void {
    infoPanel.innerHTML = '';

    const header = document.createElement('div');
    header.style.cssText = `
      padding: 24px 28px 20px;
      background: linear-gradient(135deg, rgba(197, 163, 90, 0.15), transparent);
      border-bottom: 1px solid rgba(197, 163, 90, 0.2);
    `;

    const title = document.createElement('h2');
    title.style.cssText = `
      color: #F0F0F0;
      font-size: 24px;
      font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
      font-weight: 600;
      margin: 0 0 8px 0;
      letter-spacing: 1px;
    `;
    title.textContent = `《${artwork.title}》`;

    const author = document.createElement('div');
    author.style.cssText = `
      color: #C5A35A;
      font-size: 14px;
      font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
      letter-spacing: 0.5px;
    `;
    author.textContent = `艺术家：${artwork.author}`;

    header.appendChild(title);
    header.appendChild(author);
    infoPanel.appendChild(header);

    const body = document.createElement('div');
    body.style.cssText = `
      padding: 24px 28px 28px;
    `;

    const descLabel = document.createElement('div');
    descLabel.style.cssText = `
      color: rgba(224, 224, 224, 0.5);
      font-size: 11px;
      font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
      text-transform: uppercase;
      letter-spacing: 2px;
      margin-bottom: 10px;
    `;
    descLabel.textContent = '作品简介';

    const desc = document.createElement('p');
    desc.style.cssText = `
      color: #D8D8D8;
      font-size: 14px;
      font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
      line-height: 1.8;
      margin: 0 0 20px 0;
    `;
    desc.textContent = artwork.description;

    const infoGrid = document.createElement('div');
    infoGrid.style.cssText = `
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      padding: 16px;
      background: rgba(197, 163, 90, 0.06);
      border-radius: 10px;
      border: 1px solid rgba(197, 163, 90, 0.15);
    `;

    const infoItems = [
      { label: '编号', value: `#${String(artwork.id + 1).padStart(3, '0')}` },
      { label: '尺寸', value: '1.2 × 1.5' },
      { label: '材质', value: '数字画布' },
      { label: '风格', value: '现代抽象' }
    ];

    infoItems.forEach(item => {
      const itemDiv = document.createElement('div');
      const labelDiv = document.createElement('div');
      labelDiv.style.cssText = `
        color: rgba(224, 224, 224, 0.5);
        font-size: 11px;
        margin-bottom: 4px;
      `;
      labelDiv.textContent = item.label;
      const valueDiv = document.createElement('div');
      valueDiv.style.cssText = `
        color: #F0F0F0;
        font-size: 13px;
        font-weight: 500;
      `;
      valueDiv.textContent = item.value;
      itemDiv.appendChild(labelDiv);
      itemDiv.appendChild(valueDiv);
      infoGrid.appendChild(itemDiv);
    });

    body.appendChild(descLabel);
    body.appendChild(desc);
    body.appendChild(infoGrid);
    infoPanel.appendChild(body);

    const closeBtn = document.createElement('button');
    closeBtn.style.cssText = `
      position: absolute;
      top: 16px;
      right: 16px;
      width: 32px;
      height: 32px;
      border-radius: 50%;
      border: none;
      background: rgba(255, 255, 255, 0.08);
      color: rgba(224, 224, 224, 0.7);
      font-size: 18px;
      cursor: pointer;
      pointer-events: auto;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.3s ease-out;
      font-family: inherit;
    `;
    closeBtn.textContent = '×';
    closeBtn.addEventListener('mouseenter', () => {
      closeBtn.style.background = 'rgba(197, 163, 90, 0.25)';
      closeBtn.style.color = '#F0F0F0';
    });
    closeBtn.addEventListener('mouseleave', () => {
      closeBtn.style.background = 'rgba(255, 255, 255, 0.08)';
      closeBtn.style.color = 'rgba(224, 224, 224, 0.7)';
    });
    closeBtn.addEventListener('click', hideInfoPanel);
    infoPanel.appendChild(closeBtn);

    infoPanel.style.opacity = '1';
    infoPanel.style.pointerEvents = 'auto';
    infoPanel.style.transform = 'translate(-50%, -50%) scale(1)';
  }

  function hideInfoPanel(): void {
    infoPanel.style.opacity = '0';
    infoPanel.style.pointerEvents = 'none';
    infoPanel.style.transform = 'translate(-50%, -50%) scale(0.9)';
    if (callbacks.onInfoPanelClose) {
      callbacks.onInfoPanelClose();
    }
  }

  return {
    container,
    setThumbnails,
    setFocusedArtwork,
    updateDistance,
    showInfoPanel,
    hideInfoPanel,
    get joystickActive() { return joystickActive; },
    getJoystickVector: () => ({ ...joystickVector })
  };
}
