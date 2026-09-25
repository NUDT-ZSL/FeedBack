// @vitest-environment node
const request = require('supertest');
const { createApp } = require('./server');

describe('annotations API - batch, aggregation and cross-module key boundaries', () => {
  let app;
  beforeEach(() => {
    app = createApp();
  });

  it('creates a batch, skipping invalid items but keeping valid ones', async () => {
    const res = await request(app)
      .post('/api/annotations/batch')
      .send({
        annotations: [
          { pageNum: 1, text: 'valid one' },
          { pageNum: 2 }, // missing text -> skipped
          { text: 'missing page' }, // missing pageNum -> skipped
          { pageNum: 2, text: 'valid two', note: 'n' },
        ],
      });
    expect(res.status).toBe(201);
    expect(res.body.created).toBe(2);

    const p1 = await request(app).get('/api/annotations/1');
    const p2 = await request(app).get('/api/annotations/2');
    expect(p1.body.annotations).toHaveLength(1);
    expect(p2.body.annotations).toHaveLength(1);
    expect(p2.body.annotations[0].text).toBe('valid two');
  });

  it('rejects a non-array batch payload and accepts an empty array', async () => {
    const bad = await request(app)
      .post('/api/annotations/batch')
      .send({ annotations: 'not-an-array' });
    expect(bad.status).toBe(400);

    const empty = await request(app)
      .post('/api/annotations/batch')
      .send({ annotations: [] });
    expect(empty.status).toBe(201);
    expect(empty.body.created).toBe(0);
  });

  it('aggregates all pages sorted by page number', async () => {
    await request(app).post('/api/annotations').send({ pageNum: 5, text: 'late' });
    await request(app).post('/api/annotations').send({ pageNum: 1, text: 'early' });
    await request(app).post('/api/annotations').send({ pageNum: 3, text: 'middle' });

    const all = await request(app).get('/api/annotations');
    expect(all.body.pages.map((p) => p.pageNum)).toEqual([1, 3, 5]);
  });

  it('groups numeric and string page numbers into the same page bucket', async () => {
    // The client sends numbers, but a JSON producer may send strings;
    // both must land on the same page or the panel would split one page.
    await request(app).post('/api/annotations').send({ pageNum: 4, text: 'numeric' });
    await request(app).post('/api/annotations').send({ pageNum: '4', text: 'string' });

    const page = await request(app).get('/api/annotations/4');
    expect(page.body.annotations).toHaveLength(2);

    const all = await request(app).get('/api/annotations');
    expect(all.body.pages).toHaveLength(1);
    expect(all.body.pages[0].pageNum).toBe(4);
  });

  it('clears all annotations, and clearing twice stays a safe no-op', async () => {
    await request(app).post('/api/annotations').send({ pageNum: 1, text: 'a' });
    await request(app).post('/api/annotations').send({ pageNum: 2, text: 'b' });

    expect((await request(app).delete('/api/annotations')).status).toBe(200);
    const all = await request(app).get('/api/annotations');
    expect(all.body.pages).toHaveLength(0);

    // repeated clear must not error
    expect((await request(app).delete('/api/annotations')).status).toBe(200);

    // and the store is writable again after a clear (recovery)
    const ok = await request(app).post('/api/annotations').send({ pageNum: 1, text: 'after clear' });
    expect(ok.status).toBe(201);
  });

  it('isolates state between app instances (no shared store leakage)', async () => {
    await request(app).post('/api/annotations').send({ pageNum: 1, text: 'leak?' });
    const other = createApp();
    const all = await request(other).get('/api/annotations');
    expect(all.body.pages).toHaveLength(0);
  });
});
