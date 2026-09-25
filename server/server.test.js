// @vitest-environment node
const request = require('supertest');
const { app, annotationsStore } = require('./server');

describe('Annotation API', () => {
  beforeEach(() => {
    annotationsStore.clear();
  });

  describe('happy path', () => {
    test('GET /api/health reports ok', async () => {
      const res = await request(app).get('/api/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
    });

    test('POST /api/annotations applies defaults and persists per page', async () => {
      const res = await request(app)
        .post('/api/annotations')
        .send({ pageNum: 2, text: '重要段落' });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        pageNum: 2,
        text: '重要段落',
        highlightColor: '#fff3b0',
        note: '',
      });
      expect(res.body.id).toBeTruthy();
      expect(typeof res.body.timestamp).toBe('number');

      const page = await request(app).get('/api/annotations/2');
      expect(page.body.pageNum).toBe(2);
      expect(page.body.annotations).toHaveLength(1);
      expect(page.body.annotations[0].id).toBe(res.body.id);
    });
  });

  describe('failure and recovery', () => {
    test('rejects missing required fields, then accepts a valid retry', async () => {
      const bad = await request(app)
        .post('/api/annotations')
        .send({ pageNum: 1 });
      expect(bad.status).toBe(400);
      expect(bad.body.error).toMatch(/pageNum and text/);
      expect(annotationsStore.size).toBe(0);

      const good = await request(app)
        .post('/api/annotations')
        .send({ pageNum: 1, text: '恢复后的注解' });
      expect(good.status).toBe(201);
      const page = await request(app).get('/api/annotations/1');
      expect(page.body.annotations).toHaveLength(1);
    });

    test('rejects malformed batch payload without touching the store', async () => {
      const res = await request(app)
        .post('/api/annotations/batch')
        .send({ annotations: 'not-an-array' });
      expect(res.status).toBe(400);
      expect(annotationsStore.size).toBe(0);
    });

    test('update/delete of unknown id returns 404', async () => {
      const upd = await request(app)
        .put('/api/annotations/does-not-exist')
        .send({ note: 'x' });
      expect(upd.status).toBe(404);
      const del = await request(app).delete('/api/annotations/does-not-exist');
      expect(del.status).toBe(404);
    });
  });

  describe('state transitions: create -> update -> delete', () => {
    test('full lifecycle preserves untouched fields and bumps timestamp', async () => {
      const created = (
        await request(app)
          .post('/api/annotations')
          .send({ pageNum: 1, text: '原文', note: '旧笔记' })
      ).body;

      const updated = await request(app)
        .put(`/api/annotations/${created.id}`)
        .send({ note: '新笔记', highlightColor: '#ff0000' });
      expect(updated.status).toBe(200);
      expect(updated.body.note).toBe('新笔记');
      expect(updated.body.highlightColor).toBe('#ff0000');
      expect(updated.body.text).toBe('原文');
      expect(updated.body.timestamp).toBeGreaterThanOrEqual(created.timestamp);

      const del = await request(app).delete(`/api/annotations/${created.id}`);
      expect(del.status).toBe(200);

      const page = await request(app).get('/api/annotations/1');
      expect(page.body.annotations).toHaveLength(0);
    });

    test('deleting the last annotation of a page removes the page bucket', async () => {
      const created = (
        await request(app).post('/api/annotations').send({ pageNum: 5, text: 't' })
      ).body;
      await request(app).delete(`/api/annotations/${created.id}`);

      const all = await request(app).get('/api/annotations');
      expect(all.body.pages).toEqual([]);
    });
  });

  describe('duplicate and batch operations', () => {
    test('identical payloads create two distinct annotations (no dedup)', async () => {
      const payload = { pageNum: 1, text: '重复文本' };
      const a = (await request(app).post('/api/annotations').send(payload)).body;
      const b = (await request(app).post('/api/annotations').send(payload)).body;
      expect(a.id).not.toBe(b.id);

      const page = await request(app).get('/api/annotations/1');
      expect(page.body.annotations).toHaveLength(2);
    });

    test('re-deleting an already deleted id returns 404', async () => {
      const created = (
        await request(app).post('/api/annotations').send({ pageNum: 1, text: 'x' })
      ).body;
      expect((await request(app).delete(`/api/annotations/${created.id}`)).status).toBe(200);
      expect((await request(app).delete(`/api/annotations/${created.id}`)).status).toBe(404);
    });

    test('batch creates valid items and silently skips invalid ones', async () => {
      const res = await request(app)
        .post('/api/annotations/batch')
        .send({
          annotations: [
            { pageNum: 1, text: 'ok-1' },
            { pageNum: 2 },
            { text: 'missing page' },
            { pageNum: 2, text: 'ok-2', note: 'n', highlightColor: '#00ff00' },
          ],
        });
      expect(res.status).toBe(201);
      expect(res.body.created).toBe(2);

      const all = await request(app).get('/api/annotations');
      expect(all.body.pages.map((p) => p.pageNum)).toEqual([1, 2]);
      expect(all.body.pages[1].annotations[0].highlightColor).toBe('#00ff00');
    });

    test('GET /api/annotations returns pages sorted by pageNum', async () => {
      await request(app).post('/api/annotations').send({ pageNum: 3, text: 'c' });
      await request(app).post('/api/annotations').send({ pageNum: 1, text: 'a' });
      const all = await request(app).get('/api/annotations');
      expect(all.body.pages.map((p) => p.pageNum)).toEqual([1, 3]);
    });

    test('DELETE /api/annotations clears everything', async () => {
      await request(app).post('/api/annotations').send({ pageNum: 1, text: 'x' });
      await request(app).post('/api/annotations').send({ pageNum: 2, text: 'y' });
      const res = await request(app).delete('/api/annotations');
      expect(res.status).toBe(200);
      const all = await request(app).get('/api/annotations');
      expect(all.body.pages).toEqual([]);
    });
  });
});
