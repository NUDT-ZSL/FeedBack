import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createWorkbenchStore, STORAGE_KEY, type WorkbenchStoreApi } from '../store/workbench.ts';
import { createMemoryStorage } from './memoryStorage.ts';
import { MAX_HISTORY } from '../core/seal.ts';

const createFreshStore = (): WorkbenchStoreApi =>
  createWorkbenchStore({ storage: createMemoryStorage(), storageKey: STORAGE_KEY });

describe('多印章：新增 / 删除 / 选中', () => {
  it('新增印章回到初始状态，不沿用上一方参数', () => {
    const store = createFreshStore();
    const state = store.getState();

    const firstId = state.addSeal();
    store.getState().setCharacters('印章');
    store.getState().setFont('jiudiezhuan');
    store.getState().setStyle('yinke');
    store.getState().setSize('2cun');

    const secondId = store.getState().addSeal();
    const second = store.getState().seals.find((seal) => seal.id === secondId)!;
    assert.notEqual(firstId, secondId);
    assert.deepEqual(second.state.characters, []);
    assert.equal(second.state.font, 'xiaozhuan');
    assert.equal(second.state.style, 'yangke');
    assert.equal(second.state.size, '1cun');
    assert.equal(second.state.strokes.length, 0);
    assert.equal(second.historyIndex, 0);
    assert.equal(second.history.length, 1);
    assert.equal(store.getState().selectedId, secondId);
  });

  it('删除当前印章后自动选中相邻一方', () => {
    const store = createFreshStore();
    const a = store.getState().addSeal();
    const b = store.getState().addSeal();
    const c = store.getState().addSeal();
    store.getState().selectSeal(b);
    store.getState().deleteSeal(b);
    assert.equal(store.getState().selectedId, c);

    store.getState().deleteSeal(c);
    assert.equal(store.getState().selectedId, a);
  });

  it('删除最后一方后回到空白引导态', () => {
    const store = createFreshStore();
    const id = store.getState().addSeal();
    store.getState().deleteSeal(id);
    assert.deepEqual(store.getState().seals, []);
    assert.equal(store.getState().selectedId, null);
    store.getState().addSeal();
    assert.equal(store.getState().seals.length, 1);
  });
});

describe('多印章：状态隔离', () => {
  it('切换印章后修改参数不波及其他印章', () => {
    const store = createFreshStore();
    const a = store.getState().addSeal();
    store.getState().setCharacters('甲乙丙丁');
    const b = store.getState().addSeal();
    assert.equal(store.getState().selectedId, b);

    store.getState().setCharacters('子丑');
    store.getState().setFont('miaozhuan');
    store.getState().setStyle('yinke');

    const sealA = store.getState().seals.find((seal) => seal.id === a)!;
    assert.deepEqual(sealA.state.characters, ['甲', '乙', '丙', '丁']);
    assert.equal(sealA.state.font, 'xiaozhuan');
    assert.equal(sealA.state.style, 'yangke');
    assert.equal(sealA.state.strokes.length, 4);
  });

  it('笔画偏移相互隔离且不串到其他印章', () => {
    const store = createFreshStore();
    const a = store.getState().addSeal();
    store.getState().setCharacters('印');
    const strokeA = store.getState().seals.find((s) => s.id === a)!.state.strokes[0];
    store.getState().dragStroke(strokeA.id, { x: 100, y: 0 });
    store.getState().releaseStroke(strokeA.id);
    const committedA = store.getState().seals.find((s) => s.id === a)!.state.strokes[0];
    assert.equal(committedA.position.x, 20);
    assert.equal(committedA.tempOffset.x, 0);

    const b = store.getState().addSeal();
    store.getState().setCharacters('章');
    const strokeB = store.getState().seals.find((s) => s.id === b)!.state.strokes[0];
    store.getState().dragStroke(strokeB.id, { x: -5, y: 7 });
    store.getState().releaseStroke(strokeB.id);

    const sealA = store.getState().seals.find((s) => s.id === a)!;
    assert.equal(sealA.state.strokes[0].position.x, 20);
    assert.equal(sealA.state.strokes[0].position.y, 0);
    const sealB = store.getState().seals.find((s) => s.id === b)!;
    assert.equal(sealB.state.strokes[0].position.x, -5);
    assert.equal(sealB.state.strokes[0].position.y, 7);
  });

  it('撤销 / 重做只影响当前印章', () => {
    const store = createFreshStore();
    const a = store.getState().addSeal();
    store.getState().setCharacters('印');
    const b = store.getState().addSeal();
    store.getState().setCharacters('章');

    store.getState().selectSeal(a);
    assert.ok(store.getState().undo());
    const sealA = store.getState().seals.find((s) => s.id === a)!;
    assert.deepEqual(sealA.state.characters, []);
    const sealB = store.getState().seals.find((s) => s.id === b)!;
    assert.deepEqual(sealB.state.characters, ['章']);
    assert.equal(sealB.historyIndex, 1);

    assert.equal(store.getState().redo(), '输入文字');
    assert.deepEqual(store.getState().seals.find((s) => s.id === a)!.state.characters, ['印']);
    assert.deepEqual(store.getState().seals.find((s) => s.id === b)!.state.characters, ['章']);
  });

  it('相邻笔画弹性跟随在松手后弹回原位，不写入位置', () => {
    const store = createFreshStore();
    store.getState().addSeal();
    store.getState().setCharacters('印章');
    const [first, second] = store.getState().seals[0].state.strokes;

    store.getState().dragStroke(first.id, { x: 10, y: 0 });
    const during = store.getState().seals[0].state.strokes;
    assert.equal(during[1].tempOffset.x, 3);
    assert.equal(during[1].position.x, 0);

    store.getState().releaseStroke(first.id);
    const after = store.getState().seals[0].state.strokes;
    assert.equal(after[0].position.x, 10);
    assert.equal(after[1].position.x, 0);
    assert.equal(after[1].tempOffset.x, 0);
    assert.equal(second.id, after[1].id);
  });

  it('历史最多保留 15 步', () => {
    const store = createFreshStore();
    store.getState().addSeal();
    for (let index = 0; index < 20; index += 1) {
      store.getState().setStyle(index % 2 === 0 ? 'yinke' : 'yangke');
    }
    const seal = store.getState().seals[0];
    assert.ok(seal.history.length <= MAX_HISTORY);
    assert.equal(seal.history.length, MAX_HISTORY);
  });
});

describe('钤盖与导出作用域', () => {
  it('钤盖只属于当前印章，删除印章时一并清除', () => {
    const store = createFreshStore();
    const a = store.getState().addSeal();
    store.getState().setCharacters('印');
    store.getState().stampCurrent();
    store.getState().setCharacters('印章');
    store.getState().stampCurrent();

    const b = store.getState().addSeal();
    store.getState().setCharacters('章');
    const recordB = store.getState().stampCurrent();

    assert.equal(store.getState().stamps[a]!.length, 2);
    assert.equal(store.getState().stamps[b]!.length, 1);
    assert.deepEqual(store.getState().stamps[a]![1].snapshot.characters, ['印', '章']);
    assert.ok(recordB);

    store.getState().deleteSeal(a);
    assert.equal(store.getState().stamps[a], undefined);
    assert.equal(store.getState().stamps[b]!.length, 1);
  });

  it('未输入印文时不能钤盖', () => {
    const store = createFreshStore();
    store.getState().addSeal();
    assert.equal(store.getState().stampCurrent(), null);
  });
});
