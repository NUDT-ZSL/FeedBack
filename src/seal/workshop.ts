import type { WoodType } from '../types.ts';
import {
  SealFont,
  DEFAULT_DRAFT,
  copyDraft,
} from './model.ts';
import type {
  CarveDraft,
  CarvedSeal,
  StampRecord,
  ExportArtifact,
} from './model.ts';
import { validateCarveParams } from './validation.ts';
import type { ValidationResult } from './validation.ts';

export interface CarveResult {
  ok: boolean;
  seal?: CarvedSeal;
  errors?: ValidationResult['errors'];
}

export interface WorkshopSnapshot {
  draft: CarveDraft;
  carved: CarvedSeal | null;
  stamps: StampRecord[];
  lastValidation: ValidationResult | null;
  sealCount: number;
}

export class SealWorkshop {
  private draft: CarveDraft = copyDraft(DEFAULT_DRAFT);
  private carved: CarvedSeal | null = null;
  private stamps: StampRecord[] = [];
  private lastValidation: ValidationResult | null = null;
  private sealCounter = 0;
  private stampCounter = 0;

  private readonly now: () => number;

  constructor(now?: () => number) {
    this.now = now ?? (() => Date.now());
  }

  snapshot(): WorkshopSnapshot {
    return {
      draft: copyDraft(this.draft),
      carved: this.carved ? { ...this.carved, params: copyDraft(this.carved.params) } : null,
      stamps: this.stamps.map((s) => ({ ...s, params: copyDraft(s.params) })),
      lastValidation: this.lastValidation
        ? { ok: this.lastValidation.ok, errors: [...this.lastValidation.errors] }
        : null,
      sealCount: this.sealCounter,
    };
  }

  beginSeal(): void {
    this.draft = copyDraft(DEFAULT_DRAFT);
    this.lastValidation = null;
  }

  selectWood(wood: WoodType): void {
    this.draft.wood = wood;
    this.lastValidation = null;
  }

  setSize(sizeMm: number): void {
    this.draft.sizeMm = sizeMm;
    this.lastValidation = null;
  }

  setFont(font: SealFont): void {
    this.draft.font = font;
    this.lastValidation = null;
  }

  setText(text: string): void {
    this.draft.text = text;
    this.lastValidation = null;
  }

  validateDraft(): ValidationResult {
    this.lastValidation = validateCarveParams(this.draft);
    return { ok: this.lastValidation.ok, errors: [...this.lastValidation.errors] };
  }

  carve(): CarveResult {
    const result = this.validateDraft();
    if (!result.ok) {
      return { ok: false, errors: result.errors };
    }
    this.sealCounter += 1;
    this.carved = {
      sealId: `seal-${this.sealCounter}`,
      params: copyDraft(this.draft),
      carvedAt: this.now(),
    };
    return { ok: true, seal: { ...this.carved, params: copyDraft(this.carved.params) } };
  }

  stamp(x: number, y: number, rotation = 0): StampRecord {
    if (!this.carved) {
      throw new Error('no carved seal to stamp');
    }
    this.stampCounter += 1;
    const record: StampRecord = {
      stampId: `stamp-${this.stampCounter}`,
      sealId: this.carved.sealId,
      params: copyDraft(this.carved.params),
      seq: this.stampCounter,
      x,
      y,
      rotation,
      stampedAt: this.now(),
    };
    this.stamps.push(record);
    return { ...record, params: copyDraft(record.params) };
  }

  export(): ExportArtifact {
    const artifact: ExportArtifact = {
      exportedAt: this.now(),
      sealCount: this.sealCounter,
      stamps: this.stamps.map((s) => ({ ...s, params: copyDraft(s.params) })),
    };
    this.reset();
    return artifact;
  }

  clear(): void {
    this.reset();
  }

  private reset(): void {
    this.draft = copyDraft(DEFAULT_DRAFT);
    this.carved = null;
    this.stamps = [];
    this.lastValidation = null;
    this.sealCounter = 0;
    this.stampCounter = 0;
  }
}
