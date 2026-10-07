import {
  WoodType,
  type CarveParams,
  type CarvedSeal,
  type ExportedArtwork,
  type FontId,
  type SealPhase,
  type StampRecord,
  type ValidationResult,
  type WoodProperties,
  woodProperties,
} from './types.ts';
import { validateCarveParams } from './validation.ts';
import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  CanvasModel,
  INK_COLOR,
  slotPosition,
} from './canvas.ts';
import { WorkshopError } from './errors.ts';

export const DEFAULT_PARAMS: CarveParams = {
  sizeMm: 20,
  fontId: 'zhuanshu' as FontId,
  text: '',
};

export interface StoreOptions {
  offline?: boolean;
  clock?: () => number;
}

export interface StoreSnapshot {
  phase: SealPhase;
  selectedWood: WoodType | null;
  params: CarveParams;
  validation: ValidationResult;
  currentSeal: CarvedSeal | null;
  stampRecords: StampRecord[];
  ledger: CarvedSeal[];
  sealCounter: number;
  stampCounter: number;
}

export class WorkshopStore {
  private offline: boolean;
  private clock: () => number;

  private _phase: SealPhase = 'idle';
  private _selectedWood: WoodType | null = null;
  private _params: CarveParams = { ...DEFAULT_PARAMS };
  private _validation: ValidationResult = validateCarveParams(null, DEFAULT_PARAMS);
  private _currentSeal: CarvedSeal | null = null;
  private canvas = new CanvasModel();
  private ledger: CarvedSeal[] = [];
  private sealCounter = 0;
  private stampCounter = 0;

  constructor(options: StoreOptions = {}) {
    this.offline = options.offline ?? true;
    this.clock = options.clock ?? (() => Date.now());
  }

  get phase(): SealPhase {
    return this._phase;
  }

  get selectedWood(): WoodType | null {
    return this._selectedWood;
  }

  get params(): CarveParams {
    return { ...this._params };
  }

  get validation(): ValidationResult {
    return structuredClone(this._validation);
  }

  get currentSeal(): CarvedSeal | null {
    return this._currentSeal ? structuredClone(this._currentSeal) : null;
  }

  get stampRecords(): StampRecord[] {
    return this.canvas.getRecords();
  }

  get completedSeals(): CarvedSeal[] {
    return this.ledger.map((s) => structuredClone(s));
  }

  selectWood(wood: WoodType): void {
    if (this._phase === 'carved') {
      throw new WorkshopError(
        'INVALID_PHASE',
        '当前一方印已刻制，需先完成或重置，才能更换木料',
      );
    }
    this._selectedWood = wood;
    this._phase = 'drafting';
    this.revalidate();
  }

  updateParams(patch: Partial<CarveParams>): void {
    if (this._phase !== 'drafting') {
      throw new WorkshopError(
        'INVALID_PHASE',
        '仅在选料绘制阶段可以调整尺寸、字体或印文',
      );
    }
    this._params = { ...this._params, ...patch };
    this.revalidate();
  }

  carve(): CarvedSeal {
    if (this._phase !== 'drafting') {
      throw new WorkshopError('INVALID_PHASE', '尚未进入绘制阶段，无法刻制');
    }
    const result = validateCarveParams(this._selectedWood, this._params, {
      offline: this.offline,
    });
    this._validation = result;
    if (!result.ok) {
      throw new WorkshopError(
        'VALIDATION_FAILED',
        `参数校验未通过: ${result.codes.join(',')}`,
        result.codes,
      );
    }
    const wood = this._selectedWood as WoodType;
    this.sealCounter += 1;
    const seal: CarvedSeal = {
      sealId: `seal-${this.sealCounter}`,
      wood,
      woodSnapshot: structuredClone(woodProperties[wood]) as WoodProperties,
      params: { ...this._params, text: this._params.text.trim() },
      createdAt: this.clock(),
    };
    this._currentSeal = seal;
    this._phase = 'carved';
    return structuredClone(seal);
  }

  stamp(position?: { x: number; y: number; rotation?: number }): StampRecord {
    if (this._phase !== 'carved' || this._currentSeal === null) {
      throw new WorkshopError('INVALID_PHASE', '尚未刻制完成，无法盖印');
    }
    const seal = this._currentSeal;
    this.stampCounter += 1;
    const slot = slotPosition(this.canvas.count());
    const record: StampRecord = {
      recordId: `stamp-${this.stampCounter}`,
      sealId: seal.sealId,
      wood: seal.wood,
      text: seal.params.text,
      fontId: seal.params.fontId,
      sizeMm: seal.params.sizeMm,
      x: position?.x ?? slot.x,
      y: position?.y ?? slot.y,
      rotation: position?.rotation ?? 0,
      stampedAt: this.clock(),
    };
    this.canvas.stamp(record);
    return { ...record };
  }

  finishSeal(): void {
    if (this._phase !== 'carved' || this._currentSeal === null) {
      throw new WorkshopError('INVALID_PHASE', '没有待完成的印方');
    }
    this.ledger.push(structuredClone(this._currentSeal));
    this.resetDraft();
  }

  clearCanvas(): void {
    this.canvas.clear();
  }

  exportArtwork(): ExportedArtwork {
    const records = this.canvas.getRecords();
    if (records.length === 0) {
      throw new WorkshopError('EMPTY_CANVAS', '画布为空，没有可导出的盖印');
    }
    const svg = this.canvas.exportSvg();
    const artwork: ExportedArtwork = {
      exportedAt: this.clock(),
      format: 'image/svg+xml',
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
      inkColor: INK_COLOR,
      recordCount: records.length,
      bytes: new TextEncoder().encode(svg).length,
      svg,
    };
    this.resetAll();
    return artwork;
  }

  reset(): void {
    this.resetAll();
  }

  getSnapshot(): StoreSnapshot {
    return {
      phase: this._phase,
      selectedWood: this._selectedWood,
      params: { ...this._params },
      validation: structuredClone(this._validation),
      currentSeal: this._currentSeal ? structuredClone(this._currentSeal) : null,
      stampRecords: this.canvas.getRecords(),
      ledger: this.ledger.map((s) => structuredClone(s)),
      sealCounter: this.sealCounter,
      stampCounter: this.stampCounter,
    };
  }

  private revalidate(): void {
    this._validation = validateCarveParams(this._selectedWood, this._params, {
      offline: this.offline,
    });
  }

  private resetDraft(): void {
    this._phase = 'idle';
    this._selectedWood = null;
    this._params = { ...DEFAULT_PARAMS };
    this._currentSeal = null;
    this._validation = validateCarveParams(null, DEFAULT_PARAMS);
  }

  private resetAll(): void {
    this.canvas.clear();
    this.ledger = [];
    this.sealCounter = 0;
    this.stampCounter = 0;
    this.resetDraft();
  }
}
