import type { Prop, Puppet } from '../types.ts';
import {
  PUPPET_HEIGHT,
  PUPPET_WIDTH,
  STAGE_HEIGHT,
  STAGE_WIDTH,
  type Scene,
} from './model.ts';

export type ValidationIssueKind =
  | 'puppet-out-of-stage'
  | 'mount-missing-puppet'
  | 'mount-point-invalid'
  | 'event-out-of-duration'
  | 'event-scene-mismatch'
  | 'prop-double-mount'
  | 'ledger-mismatch';

export interface ValidationRef {
  objectType: 'puppet' | 'prop' | 'event' | 'scene';
  objectId: string;
  detail: string;
}

export interface ValidationIssue {
  sceneId: string;
  sceneName: string;
  kind: ValidationIssueKind;
  message: string;
  refs: ValidationRef[];
}

export interface SceneValidationReport {
  sceneId: string;
  sceneName: string;
  issues: ValidationIssue[];
}

function issue(
  scene: Scene,
  kind: ValidationIssueKind,
  message: string,
  refs: ValidationRef[],
): ValidationIssue {
  return { sceneId: scene.id, sceneName: scene.name, kind, message, refs };
}

function validatePuppetBounds(scene: Scene, issues: ValidationIssue[]): void {
  for (const puppet of scene.puppets) {
    if (!puppet.isOnStage) continue;
    const { x, y } = puppet.position;
    const out =
      x < 0 || y < 0 || x + PUPPET_WIDTH > STAGE_WIDTH || y + PUPPET_HEIGHT > STAGE_HEIGHT;
    if (out) {
      issues.push(
        issue(scene, 'puppet-out-of-stage', `影人 ${puppet.name} 超出舞台范围`, [
          {
            objectType: 'puppet',
            objectId: puppet.id,
            detail: `position=(${x}, ${y}) size=${PUPPET_WIDTH}x${PUPPET_HEIGHT} stage=${STAGE_WIDTH}x${STAGE_HEIGHT}`,
          },
        ]),
      );
    }
  }
}

function collectLedgerAttachments(scene: Scene): Map<string, Puppet[]> {
  const byProp = new Map<string, Puppet[]>();
  for (const puppet of scene.puppets) {
    for (const prop of puppet.props) {
      const list = byProp.get(prop.id) ?? [];
      list.push(puppet);
      byProp.set(prop.id, list);
    }
  }
  return byProp;
}

function validatePropLedger(scene: Scene, issues: ValidationIssue[]): void {
  const puppetById = new Map(scene.puppets.map((puppet) => [puppet.id, puppet]));
  const ledgerByProp = new Map(scene.props.map((prop) => [prop.id, prop]));
  const ledgerAttachments = collectLedgerAttachments(scene);

  for (const prop of scene.props) {
    if (prop.attachedTo === null) {
      if (prop.attachmentPoint !== null) {
        issues.push(
          issue(scene, 'ledger-mismatch', `道具 ${prop.name} 未归属影人却带有挂载点`, [
            {
              objectType: 'prop',
              objectId: prop.id,
              detail: `attachedTo=null attachmentPoint=${prop.attachmentPoint}`,
            },
          ]),
        );
      }
      continue;
    }

    const target = puppetById.get(prop.attachedTo);
    if (!target) {
      issues.push(
        issue(scene, 'mount-missing-puppet', `道具 ${prop.name} 挂载到不存在的影人`, [
          {
            objectType: 'prop',
            objectId: prop.id,
            detail: `attachedTo=${prop.attachedTo} attachmentPoint=${String(prop.attachmentPoint)}`,
          },
          { objectType: 'puppet', objectId: prop.attachedTo, detail: '影人不存在于该场次' },
        ]),
      );
      continue;
    }

    if (prop.attachmentPoint === null) {
      issues.push(
        issue(scene, 'mount-point-invalid', `道具 ${prop.name} 已归属影人但缺少挂载点`, [
          { objectType: 'prop', objectId: prop.id, detail: `attachedTo=${target.id}` },
          { objectType: 'puppet', objectId: target.id, detail: `影人 ${target.name}` },
        ]),
      );
    }

    const holders = ledgerAttachments.get(prop.id) ?? [];
    if (holders.length > 1) {
      const refs: ValidationRef[] = [
        {
          objectType: 'prop',
          objectId: prop.id,
          detail: `账本归属 attachedTo=${prop.attachedTo} attachmentPoint=${String(prop.attachmentPoint)}`,
        },
        ...holders.map((holder) => ({
          objectType: 'puppet' as const,
          objectId: holder.id,
          detail: `影人 ${holder.name} 的道具列表也声明持有该道具 attachmentPoint=${String(
            holder.props.find((held) => held.id === prop.id)?.attachmentPoint,
          )}`,
        })),
      ];
      issues.push(
        issue(scene, 'prop-double-mount', `道具 ${prop.name} 被同时挂到多个挂载点`, refs),
      );
    }

    const ledgerHolder = holders.find((holder) => holder.id === prop.attachedTo);
    if (holders.length === 0 || !ledgerHolder) {
      issues.push(
        issue(scene, 'ledger-mismatch', `道具 ${prop.name} 账本归属与影人道具列表不一致`, [
          {
            objectType: 'prop',
            objectId: prop.id,
            detail: `账本 attachedTo=${prop.attachedTo} attachmentPoint=${String(prop.attachmentPoint)}`,
          },
          {
            objectType: 'puppet',
            objectId: prop.attachedTo,
            detail: '该影人的道具列表中没有此道具',
          },
        ]),
      );
    } else if (
      ledgerHolder.props.find((held) => held.id === prop.id)?.attachmentPoint !==
      prop.attachmentPoint
    ) {
      issues.push(
        issue(scene, 'ledger-mismatch', `道具 ${prop.name} 挂载点在账本与影人列表间不一致`, [
          {
            objectType: 'prop',
            objectId: prop.id,
            detail: `账本 attachmentPoint=${String(prop.attachmentPoint)}`,
          },
          {
            objectType: 'puppet',
            objectId: ledgerHolder.id,
            detail: `列表 attachmentPoint=${String(
              ledgerHolder.props.find((held) => held.id === prop.id)?.attachmentPoint,
            )}`,
          },
        ]),
      );
    }
  }

  for (const puppet of scene.puppets) {
    for (const held of puppet.props) {
      const ledger = ledgerByProp.get(held.id);
      if (!ledger) {
        issues.push(
          issue(scene, 'ledger-mismatch', `影人 ${puppet.name} 持有道具账本中不存在的道具`, [
            { objectType: 'puppet', objectId: puppet.id, detail: `held=${held.id}` },
            { objectType: 'prop', objectId: held.id, detail: '道具不在该场次账本中' },
          ]),
        );
        continue;
      }
      if (ledger.attachedTo !== puppet.id) {
        issues.push(
          issue(scene, 'ledger-mismatch', `道具 ${held.name} 被影人持有但账本归属其他对象`, [
            {
              objectType: 'puppet',
              objectId: puppet.id,
              detail: `影人 ${puppet.name} 列表持有 attachmentPoint=${String(held.attachmentPoint)}`,
            },
            {
              objectType: 'prop',
              objectId: ledger.id,
              detail: `账本 attachedTo=${String(ledger.attachedTo)}`,
            },
          ]),
        );
      }
    }
  }
}

function validateRecording(scene: Scene, issues: ValidationIssue[]): void {
  for (const event of scene.recording) {
    if (event.sceneId !== scene.id) {
      issues.push(
        issue(scene, 'event-scene-mismatch', `录音事件 ${event.id} 归属场次与所在场次不一致`, [
          {
            objectType: 'event',
            objectId: event.id,
            detail: `event.sceneId=${event.sceneId} 所在场次=${scene.id}`,
          },
          { objectType: 'scene', objectId: event.sceneId, detail: '事件声明的所属场次' },
        ]),
      );
    }
    if (event.timestamp < 0 || event.timestamp > scene.duration) {
      issues.push(
        issue(scene, 'event-out-of-duration', `录音事件 ${event.id} 时刻超出场次时长`, [
          {
            objectType: 'event',
            objectId: event.id,
            detail: `note=${event.note} timestamp=${event.timestamp}ms duration=${scene.duration}ms`,
          },
        ]),
      );
    }
  }
}

export function validateScene(scene: Scene): SceneValidationReport {
  const issues: ValidationIssue[] = [];
  validatePuppetBounds(scene, issues);
  validatePropLedger(scene, issues);
  validateRecording(scene, issues);
  return { sceneId: scene.id, sceneName: scene.name, issues };
}

export function validateScenes(scenes: Scene[]): SceneValidationReport[] {
  return scenes.map(validateScene);
}

export class ValidationCache {
  private reports = new Map<string, SceneValidationReport>();
  private dirty = new Set<string>();

  markDirty(sceneId: string): void {
    this.dirty.add(sceneId);
  }

  drop(sceneId: string): void {
    this.reports.delete(sceneId);
    this.dirty.delete(sceneId);
  }

  revalidate(scenes: Scene[]): SceneValidationReport[] {
    const byId = new Map(scenes.map((scene) => [scene.id, scene]));
    for (const sceneId of this.dirty) {
      const scene = byId.get(sceneId);
      if (scene) {
        this.reports.set(sceneId, validateScene(scene));
      } else {
        this.reports.delete(sceneId);
      }
    }
    this.dirty.clear();
    for (const scene of scenes) {
      if (!this.reports.has(scene.id)) {
        this.reports.set(scene.id, validateScene(scene));
      }
    }
    return scenes.map((scene) => this.reports.get(scene.id) as SceneValidationReport);
  }
}
