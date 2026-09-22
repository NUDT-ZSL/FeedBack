(function (root) {
  'use strict';
  root.createSampleState = function (Engine) {
    var state = Engine.defaultState();
    state.batches = [
      { id: 'b1', name: '第一批 · 金丝雀', ready: true },
      { id: 'b2', name: '第二批 · 灰度', ready: true },
      { id: 'b3', name: '第三批 · 全量', ready: false },
      { id: 'b4', name: '第四批 · 观察', ready: true }
    ];
    state.currentBatchId = 'b2';
    state.targets = [
      { id: 't1', name: '网关-北京-01', batchId: 'b1', labels: ['region:cn', 'tier:edge', 'canary'], baseConfig: [] },
      { id: 't2', name: '网关-上海-02', batchId: 'b2', labels: ['region:cn', 'tier:edge'], baseConfig: [] },
      { id: 't3', name: '结算-深圳-01', batchId: 'b2', labels: ['region:cn', 'service:payment'], baseConfig: [] },
      { id: 't4', name: '边缘-海外-03', batchId: 'b3', labels: ['region:us', 'tier:edge'], baseConfig: [] },
      { id: 't5', name: '缓存-成都-01', batchId: 'b1', labels: ['service:cache', 'canary'], baseConfig: [] }
    ];

    Engine.publishRule(state, 'R-LOW-LATENCY', {
      key: 'timeout_ms', value: '1200', priority: 10, effectiveBatch: 'b1',
      scopeBatches: ['b1', 'b2', 'b3'], scopeLabels: ['tier:edge']
    });
    Engine.publishRule(state, 'R-HIGH-LATENCY', {
      key: 'timeout_ms', value: '1800', priority: 20, effectiveBatch: 'b2',
      scopeBatches: ['b2', 'b3'], scopeLabels: ['tier:edge']
    });
    Engine.publishRule(state, 'R-CANARY-CACHE', {
      key: 'cache_ttl_s', value: '45', priority: 15, effectiveBatch: 'b1',
      scopeBatches: ['b1'], scopeLabels: ['service:cache']
    });
    Engine.publishRule(state, 'R-FUTURE-TLS', {
      key: 'tls_mode', value: 'strict', priority: 30, effectiveBatch: 'b4',
      scopeBatches: ['b1', 'b2', 'b3', 'b4'], scopeLabels: []
    });
    Engine.publishRule(state, 'R-BAD-POINTER', {
      key: 'feature_flag', value: 'on', priority: 5, effectiveBatch: 'b9',
      scopeBatches: ['b2', 'b9'], scopeLabels: []
    });
    return state;
  };
})(typeof window !== 'undefined' ? window : globalThis);
