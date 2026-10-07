export interface WorkOrderRecord {
  timestamp: number;
  productType: string;
  hardness: number;
  toughness: number;
  sharpness: number;
  grade: '上品' | '良品' | '次品';
}

export class WorkOrderStore {
  private records: WorkOrderRecord[];
  private maxRecords: number;
  private updateListeners: Array<() => void>;

  constructor() {
    this.records = [];
    this.maxRecords = 20;
    this.updateListeners = [];
  }

  addRecord(record: Omit<WorkOrderRecord, 'timestamp' | 'grade'>): WorkOrderRecord {
    const total = record.hardness + record.toughness + record.sharpness;
    let grade: '上品' | '良品' | '次品';
    
    if (total > 240) {
      grade = '上品';
    } else if (total > 200) {
      grade = '良品';
    } else {
      grade = '次品';
    }
    
    const newRecord: WorkOrderRecord = {
      ...record,
      timestamp: Date.now(),
      grade
    };
    
    this.records.unshift(newRecord);
    
    if (this.records.length > this.maxRecords) {
      this.records.pop();
    }
    
    this.notifyUpdate();
    
    return newRecord;
  }

  getRecords(): WorkOrderRecord[] {
    return [...this.records];
  }

  onUpdate(callback: () => void): void {
    this.updateListeners.push(callback);
  }

  private notifyUpdate(): void {
    this.updateListeners.forEach(callback => callback());
  }

  exportScreenshot(element: HTMLElement): string {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    
    const rect = element.getBoundingClientRect();
    const scale = 2;
    canvas.width = rect.width * scale;
    canvas.height = rect.height * scale;
    
    ctx.fillStyle = '#f5deb3';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    ctx.scale(scale, scale);
    
    const typeNames: Record<string, string> = {
      sword: '宝剑',
      plow: '犁铧',
      ding: '宝鼎'
    };
    
    let y = 20;
    ctx.fillStyle = '#8b0000';
    ctx.font = 'bold 24px "Ma Shan Zheng", cursive';
    ctx.textAlign = 'center';
    ctx.fillText('冶铁工单 · 天工开物', rect.width / 2, y);
    y += 40;
    
    ctx.strokeStyle = '#b8860b';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(20, y);
    ctx.lineTo(rect.width - 20, y);
    ctx.stroke();
    y += 20;
    
    this.records.forEach((record, index) => {
      const gradeColors: Record<string, string> = {
        '上品': '#ffd700',
        '良品': '#44ff44',
        '次品': '#ff4444'
      };
      
      ctx.fillStyle = gradeColors[record.grade];
      ctx.fillRect(20, y - 15, 12, 40);
      
      ctx.fillStyle = '#8b0000';
      ctx.font = 'bold 18px "Ma Shan Zheng", cursive';
      ctx.textAlign = 'left';
      ctx.fillText(typeNames[record.productType], 45, y);
      y += 25;
      
      ctx.fillStyle = '#2c1e0e';
      ctx.font = '14px "Ma Shan Zheng", cursive';
      ctx.fillText(`时间：${new Date(record.timestamp).toLocaleString()}`, 45, y);
      y += 20;
      
      ctx.fillStyle = '#ff4444';
      ctx.fillText(`硬度：${record.hardness}%`, 45, y);
      ctx.fillStyle = '#44ff44';
      ctx.fillText(`韧性：${record.toughness}%`, 145, y);
      ctx.fillStyle = '#4444ff';
      ctx.fillText(`锋利度：${record.sharpness}%`, 245, y);
      y += 25;
      
      ctx.fillStyle = '#2c1e0e';
      ctx.font = 'bold 16px "Ma Shan Zheng", cursive';
      const total = record.hardness + record.toughness + record.sharpness;
      ctx.fillText(`品级：${record.grade} (${total}分)`, 45, y);
      
      y += 35;
      
      if (index < this.records.length - 1) {
        ctx.strokeStyle = '#b8860b';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(20, y - 10);
        ctx.lineTo(rect.width - 20, y - 10);
        ctx.stroke();
      }
    });
    
    return canvas.toDataURL('image/png');
  }
}
