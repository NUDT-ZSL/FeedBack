import { ForgeScene } from './core/ForgeScene';
import { FurnaceSystem } from './core/FurnaceSystem';
import { InteractionPanel } from './ui/InteractionPanel';
import { WorkOrderStore, WorkOrderRecord } from './data/WorkOrderStore';

const canvasContainer = document.getElementById('canvas-container')!;

const workOrderStore = new WorkOrderStore();
const forgeScene = new ForgeScene(canvasContainer);
const furnaceSystem = new FurnaceSystem(forgeScene);
const interactionPanel = new InteractionPanel(forgeScene, furnaceSystem, workOrderStore);

forgeScene.init();
furnaceSystem.init();
interactionPanel.init();

workOrderStore.onUpdate(() => {
  updateWorkOrderList();
});

function updateWorkOrderList(): void {
  const list = document.getElementById('work-order-list')!;
  const records = workOrderStore.getRecords();
  
  list.innerHTML = '';
  
  if (records.length === 0) {
    list.innerHTML = '<div style="text-align: center; color: #888; padding: 20px;">暂无工单记录</div>';
    return;
  }
  
  records.forEach(record => {
    const item = document.createElement('div');
    item.className = 'work-order-item';
    
    const typeNames: Record<string, string> = {
      sword: '宝剑',
      plow: '犁铧',
      ding: '宝鼎'
    };
    
    item.innerHTML = `
      <div class="grade-badge grade-${record.grade}"></div>
      <div class="order-content">
        <div class="order-type">${typeNames[record.productType]} · ${new Date(record.timestamp).toLocaleTimeString()}</div>
        <div class="order-stats">
          <span class="stat-hard">硬${record.hardness}%</span>
          <span class="stat-tough">韧${record.toughness}%</span>
          <span class="stat-sharp">锋${record.sharpness}%</span>
        </div>
        <div class="order-grade">${record.grade} (${record.hardness + record.toughness + record.sharpness}分)</div>
      </div>
    `;
    
    list.appendChild(item);
  });
}

document.getElementById('btn-expand-scroll')!.addEventListener('click', () => {
  const overlay = document.getElementById('scroll-overlay')!;
  const container = document.getElementById('scroll-container')!;
  const content = document.getElementById('scroll-content')!;
  
  const records = workOrderStore.getRecords();
  const typeNames: Record<string, string> = {
    sword: '宝剑',
    plow: '犁铧',
    ding: '宝鼎'
  };
  
  content.innerHTML = records.map(record => `
    <div style="padding: 15px; border-bottom: 1px solid #b8860b; display: flex;">
      <div style="width: 12px; background: ${record.grade === '上品' ? '#ffd700' : record.grade === '良品' ? '#44ff44' : '#ff4444'}; margin-right: 15px; border-radius: 2px;"></div>
      <div style="flex: 1;">
        <div style="font-size: 18px; color: #8b0000; font-weight: bold;">${typeNames[record.productType]}</div>
        <div style="margin-top: 5px;">时间：${new Date(record.timestamp).toLocaleString()}</div>
        <div style="margin-top: 5px; display: flex; gap: 20px;">
          <span style="color: #ff4444;">硬度：${record.hardness}%</span>
          <span style="color: #44ff44;">韧性：${record.toughness}%</span>
          <span style="color: #4444ff;">锋利度：${record.sharpness}%</span>
        </div>
        <div style="margin-top: 5px; font-size: 16px; font-weight: bold;">品级：${record.grade} (${record.hardness + record.toughness + record.sharpness}分)</div>
      </div>
    </div>
  `).join('');
  
  overlay.classList.add('active');
  container.classList.remove('expanding');
  void container.offsetWidth;
  container.classList.add('expanding');
});

document.getElementById('scroll-close')!.addEventListener('click', () => {
  document.getElementById('scroll-overlay')!.classList.remove('active');
});

document.getElementById('btn-screenshot')!.addEventListener('click', () => {
  const dataUrl = workOrderStore.exportScreenshot(document.getElementById('scroll-content')!);
  const link = document.createElement('a');
  link.download = `冶铁工单_${new Date().toISOString().slice(0, 10)}.png`;
  link.href = dataUrl;
  link.click();
});

updateWorkOrderList();

function animate(): void {
  requestAnimationFrame(animate);
  forgeScene.update();
  furnaceSystem.update();
}

animate();
