import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createWorkbenchStore, STORAGE_KEY } from '../store/workbench.ts';
import { createMemoryStorage } from './memoryStorage.ts';
import { buildDesignSvg } from '../core/renderer.ts';

const hydrate = (serialized: string) => {
  const storage = createMemoryStorage({ [STORAGE_KEY]: serialized });
  return createWorkbenchStore({ storage, storageKey: STORAGE_KEY });
};

describe('刷新恢复：序列化与恢复', () => {
  it('印章数量、顺序、选中态与全部参数完整恢复', () => {
    const storage = createMemoryStorage();
    const store = createWorkbenchStore({ storage, storageKey: STORAGE_KEY });
    const a = store.getState().addSeal();
    store.getState().setCharacters('印章');
    store.getState().setFont('jiudiezhuan');
    store.getState().setSize('2cun');
    store.getState().setStyle('yinke');
    const b = store.getState().addSeal();
    store.getState().setCharacters('书画');
    const strokeId = store.getState().seals[1].state.strokes[0].id;
    store.getState().dragStroke(strokeId, { x: 12, y: -8 });
    store.getState().releaseStroke(strokeId);
    store.getState().stampCurrent();

    const serialized = storage.dump()[STORAGE_KEY];
    const restored = hydrate(serialized);
    assert.equal(restored.getState().seals.length, 2);
    assert.equal(restored.getState().seals[0].id, a);
    assert.equal(restored.getState().seals[1].id, b);
    assert.equal(restored.getState().selectedId, b);
    assert.equal(restored.getState().sealCounter, 2);

    const first = restored.getState().seals[0];
    assert.deepEqual(first.state.characters, ['印', '章']);
    assert.equal(first.state.font, 'jiudiezhuan');
    assert.equal(first.state.size, '2cun');
    assert.equal(first.state.style, 'yinke');
    assert.equal(first.state.strokes.length, 2);

    const second = restored.getState().seals[1];
    assert.deepEqual(second.state.characters, ['书', '画']);
    assert.equal(second.state.strokes[0].position.x, 12);
    assert.equal(second.state.strokes[0].position.y, -8);
    assert.equal(second.state.strokes[0].tempOffset.x, 0);
    assert.ok(second.history.length >= 2);
    assert.ok(second.history.some((entry) => entry.state.strokes[0]?.position.x === 12));
  });

  it('撤销历史随印章一并恢复，恢复后可继续撤销', () => {
    const storage = createMemoryStorage();
    const store = createWorkbenchStore({ storage, storageKey: STORAGE_KEY });
    store.getState().addSeal();
    store.getState().setCharacters('印');
    store.getState().setStyle('yinke');

    const restored = hydrate(storage.dump()[STORAGE_KEY]);
    const seal = restored.getState().seals[0];
    assert.equal(seal.history.length, 3);
    assert.equal(seal.historyIndex, 2);
    assert.equal(restored.getState().undo(), '切换刀法');
    assert.equal(restored.getState().seals[0].state.style, 'yangke');
    assert.equal(restored.getState().redo(), '切换刀法');
    assert.equal(restored.getState().seals[0].state.style, 'yinke');
  });

  it('钤盖快照在恢复后保持当时状态，不受后续修改影响', () => {
    const storage = createMemoryStorage();
    const store = createWorkbenchStore({ storage, storageKey: STORAGE_KEY });
    store.getState().addSeal();
    store.getState().setCharacters('印');
    store.getState().stampCurrent();
    store.getState().setFont('jiudiezhuan');

    const restored = hydrate(storage.dump()[STORAGE_KEY]);
    const sealId = restored.getState().seals[0].id;
    const records = restored.getState().stamps[sealId];
    assert.equal(records.length, 1);
    assert.equal(records[0].snapshot.font, 'xiaozhuan');
    assert.equal(restored.getState().seals[0].state.font, 'jiudiezhuan');
    assert.doesNotThrow(() => buildDesignSvg(restored.getState().seals[0].state));
  });

  it('空白工坊序列化后恢复仍是空白引导态', () => {
    const storage = createMemoryStorage();
    createWorkbenchStore({ storage, storageKey: STORAGE_KEY });
    const restored = hydrate(storage.dump()[STORAGE_KEY]);
    assert.deepEqual(restored.getState().seals, []);
    assert.equal(restored.getState().selectedId, null);
  });
});
