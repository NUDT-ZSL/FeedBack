(function (root) {
  'use strict';
  root.DEMO_DATA = {
    name: '综合站房示例',
    objects: [
      { id: 'FLOOR-01', parentId: null, position: [0,0,0], rotationEuler: [0,0,0], size: [14,9,0.2] },
      { id: 'WALL-W', parentId: null, position: [-6.5,0,1.6], rotationEuler: [0,0,0], size: [0.25,9,3.2] },
      { id: 'WALL-E', parentId: null, position: [6.5,0,1.6], rotationEuler: [0,0,0], size: [0.25,9,3.2] },
      { id: 'WALL-N', parentId: null, position: [0,4,1.6], rotationEuler: [0,0,0], size: [13.2,0.25,3.2] },
      { id: 'BEAM-01', parentId: null, position: [0,-1.5,3.6], rotationEuler: [0,0,0], size: [13.2,0.35,0.45] },
      { id: 'SKID-01', parentId: 'FLOOR-01', position: [-1.8,0,0.1], rotationEuler: [0,0,0], size: [4.6,2.0,0.25] },
      { id: 'PUMP-01', parentId: 'SKID-01', position: [-0.7,0.25,0.62], rotationEuler: [0,0,0], size: [1.25,0.9,1.0] },
      { id: 'PUMP-02', parentId: 'SKID-01', position: [1.05,0.25,0.62], rotationEuler: [0,0,0], size: [1.25,0.9,1.0] },
      { id: 'MOTOR-01', parentId: 'PUMP-01', position: [0,1.02,0], rotationEuler: [0,0,0], size: [1.0,1.25,0.8] },
      { id: 'MOTOR-02', parentId: 'PUMP-02', position: [0,1.02,0], rotationEuler: [0,0,0], size: [1.0,1.25,0.8] },
      { id: 'PIPE-MAIN', parentId: null, position: [0.2,-2.6,1.42], rotationEuler: [0,0,0], size: [9.8,0.28,0.28] },
      { id: 'PIPE-RISER', parentId: 'PIPE-MAIN', position: [-0.9,0,0.45], rotationEuler: [0,0,0], size: [0.28,0.28,0.9] },
      { id: 'DUCT-01', parentId: null, position: [1.5,2.8,3.05], rotationEuler: [0,0,0], size: [6.5,0.75,0.55] },
      { id: 'VALVE-01', parentId: 'PIPE-MAIN', position: [2.4,0,0], rotationEuler: [0,0,18], size: [0.42,0.5,0.5] }
    ]
  };
  root.DEMO_BAD = {
    name: '被拒绝的补录批次',
    objects: [
      { id: 'VALVE-BAD', parentId: 'GHOST-PUMP', position: [1,2,3], rotationEuler: [0,0,0], size: [0.4,-0.1,0.4] },
      { id: 'LOOP-A', parentId: 'LOOP-C', position: [0,0,0], size: [1,1,1] },
      { id: 'LOOP-B', parentId: 'LOOP-A', position: [0,0,0], size: [1,1,1] },
      { id: 'LOOP-C', parentId: 'LOOP-B', position: [0,0,0], size: [1,1,1] }
    ]
  };
}(typeof window !== 'undefined' ? window : globalThis));