// @vitest-environment node
const request = require('supertest');
const { createApp } = require('./server');

describe('annotations API - CRUD happy path and state transitions', () => {
  let app;
  beforeEach(() => {
    app = createApp();
  });

  it('reports health', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('creates an annotation with server-generated id, defaults and timestamp', async () => {
    const res = await request(app)
      .post('/api/annotations')
      .send({ pageNum: 3, text: 'important passage' });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeTruthy();
    expect(res.body.highlightColor).toBe('#fff3b0');
    expect(res.body.note).toBe('');
    expect(typeof res.body.timestamp).toBe('number');

    const page = await request(app).get('/api/annotations/3');
    expect(page.body.annotations).toHaveLength(1);
    expect(page.body.annotations[0].text).toBe('important passage');
  });

  it('returns an empty list for a page that has no annotations', async () => {
    const res = await request(app).get('/api/annotations/9');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ pageNum: 9, annotations: [] });
  });

  it('updates note and color, and rejects updates to unknown ids', async () => {
    const created = await request(app)
      .post('/api/annotations')
      .send({ pageNum: 1, text: 'hello' });
    const id = created.body.id;

    const updated = await request(app)
      .put(`/api/annotations/${id}`)
      .send({ note: 'my note', highlightColor: '#ff0000' });
    expect(updated.status).toBe(200);
    expect(updated.body.note).toBe('my note');
    expect(updated.body.highlightColor).toBe('#ff0000');
    expect(updated.body.text).toBe('hello');
    expect(updated.body.timestamp).toBeGreaterThanOrEqual(created.body.timestamp);

    const missing = await request(app)
      .put('/api/annotations/does-not-exist')
      .send({ note: 'x' });
    expect(missing.status).toBe(404);
  });

  it('deletes an annotation and removes the emptied page from the aggregate list', async () => {
    const created = await request(app)
      .post('/api/annotations')
      .send({ pageNum: 2, text: 'temporary' });

    const del = await request(app).delete(`/api/annotations/${created.body.id}`);
    expect(del.status).toBe(200);

    const page = await request(app).get('/api/annotations/2');
    expect(page.body.annotations).toHaveLength(0);

    const all = await request(app).get('/api/annotations');
    expect(all.body.pages.find((p) => p.pageNum === 2)).toBeUndefined();
  });
});

describe('annotations API - validation failure, recovery and repeated operations', () => {
  let app;
  beforeEach(() => {
    app = createApp();
  });

  it('rejects invalid payloads with 400 and stays consistent for the retry', async () => {
    const noText = await request(app).post('/api/annotations').send({ pageNum: 1 });
    expect(noText.status).toBe(400);
    expect(noText.body.error).toMatch(/pageNum and text/);

    const noPage = await request(app).post('/api/annotations').send({ text: 'orphan' });
    expect(noPage.status).toBe(400);

    // the failed attempts must not have created any state
    const all = await request(app).get('/api/annotations');
    expect(all.body.pages).toHaveLength(0);

    // recovery: a corrected request succeeds against the same server
    const ok = await request(app)
      .post('/api/annotations')
      .send({ pageNum: 1, text: 'recovered' });
    expect(ok.status).toBe(201);
  });

  it('treats identical payloads as distinct annotations (no silent dedup)', async () => {
    const payload = { pageNum: 1, text: 'same text', note: 'same note' };
    const first = await request(app).post('/api/annotations').send(payload);
    const second = await request(app).post('/api/annotations').send(payload);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.body.id).not.toBe(second.body.id);

    const page = await request(app).get('/api/annotations/1');
    expect(page.body.annotations).toHaveLength(2);
  });

  it('returns 404 when deleting the same annotation twice', async () => {
    const created = await request(app)
      .post('/api/annotations')
      .send({ pageNum: 1, text: 'once' });
    const id = created.body.id;

    expect((await request(app).delete(`/api/annotations/${id}`)).status).toBe(200);
    const again = await request(app).delete(`/api/annotations/${id}`);
    expect(again.status).toBe(404);
    expect(again.body.error).toMatch(/not found/i);
  });
});
