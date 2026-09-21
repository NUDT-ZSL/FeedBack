const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const context = { globalThis, console, Math, Date, JSON };
vm.createContext(context);
context.globalThis = context;
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'sync-core.js'), 'utf8'), context);
const C = context.SyncCore;

test('离线修改先投影到本地工作副本，完成后再按服务端结果重放后续操作', () => {
  const server = [{ id: 'n1', title: '巡检', content: '旧内容', version: 1 }];
  const first = {
    ...C.makeMutation('update', { id: 'n1', title: '巡检', content: '本地第一次' }, 1, server[0]),
    seq: 1
  };
  const second = {
    ...C.makeMutation('update', { id: 'n1', title: '巡检-补充', content: '本地第二次' }, 1, server[0]),
    seq: 2
  };

  let working = C.projectWorkingNotes(server, [first, second]);
  assert.equal(working[0].content, '本地第二次');

  let mutations = C.rebaseAfterSuccess([
    { ...first, status: 'success' },
    second
  ], first.id, { id: 'n1', title: '巡检', content: '本地第一次', version: 2 });
  assert.equal(mutations[1].baseVersion, 2);
  assert.equal(mutations[1].status, 'queued');

  working = C.projectWorkingNotes(server, mutations);
  assert.equal(working[0].content, '本地第二次');
});

test('冲突会冻结同一条笔记的相关改动，并保留本地与服务端快照', () => {
  const base = { id: 'n1', title: '标题', content: '基础正文', version: 1 };
  const first = { ...C.makeMutation('update', { id: 'n1', title: '标题', content: '本地修改' }, 1, base), seq: 1 };
  const second = { ...C.makeMutation('delete', { id: 'n1', deleted: true }, 1, base), seq: 2 };
  const other = { ...C.makeMutation('update', { id: 'n2', title: '其他', content: '后续' }, 1, { id: 'n2', version: 1 }), seq: 3 };
  const serverConflict = {
    reason: 'updated_remotely_while_editing',
    server: { id: 'n1', title: '标题', content: '服务端修改', version: 2 }
  };
  const conflict = C.buildConflict(first, [first, second, other], serverConflict);
  const mutations = C.markConflict([first, second, other], first, conflict);

  assert.equal(mutations[0].status, 'conflict');
  assert.equal(mutations[1].status, 'conflict');
  assert.equal(mutations[2].status, 'blocked');
  assert.equal(conflict.local.content, '');
  assert.equal(conflict.local.deleted, true);
  assert.equal(conflict.server.content, '服务端修改');
});

  test('行级差异能识别新增与删除的正文行', () => {
    const diff = C.lineDiff('共同行\n旧行', '共同行\n新行');
  const types = diff.map(item => item.type).sort();
  assert.equal(types.join(','), 'add,del,equal');
  assert.ok(diff.some(item => item.type === 'add' && item.right === '新行'));
});

test('手动合并请求携带服务端冲突版本，用于乐观锁和失败重试', () => {
  const payload = C.resolutionRequest('manual', {
    server: { version: 3 },
    local: { title: '本地', content: '本地正文' }
  }, { title: '合并标题', content: '合并正文', deleted: false });
  assert.equal(payload.choice, 'manual');
  assert.equal(payload.baseVersion, 3);
  assert.equal(payload.title, '合并标题');
  assert.equal(payload.content, '合并正文');
  assert.equal(payload.deleted, false);
});

test('离线新建后首次提交前删除不会在重放后复活本地笔记', () => {
  const create = {
    ...C.makeMutation('create', { id: 'local-only', title: '临时', content: '内容' }, 0, null),
    seq: 1
  };
  const remove = {
    ...C.makeMutation('delete', { id: 'local-only', deleted: true, localDeleted: true }, 0, null, {
      title: '临时',
      content: '',
      localDeleted: true
    }),
    seq: 2
  };
  create.localDeleted = false;
  assert.equal(C.projectWorkingNotes([], [create, remove]).length, 0);
});
