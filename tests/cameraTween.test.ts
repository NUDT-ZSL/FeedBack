import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { CameraTween } from '../src/core/cameraTween';
import { easeInOutCubic } from '../src/core/easing';

const START = new THREE.Vector3(0, 0, 8);
const END = new THREE.Vector3(0, 4, 4);
const TARGET_START = new THREE.Vector3(0, 0, 0);
describe('CameraTween 相机补间按进度取值', () => {
  it('进度 0 为起点、1 为终点', () => {
    const tween = new CameraTween(START, END, TARGET_START, TARGET_START, 2000);
    expect(tween.sampleAt(0).position.toArray()).toEqual(START.toArray());
    expect(tween.sampleAt(2000).position.toArray()).toEqual(END.toArray());
    expect(tween.sampleAt(2000).target.toArray()).toEqual([0, 0, 0]);
    expect(tween.sampleAt(2000).done).toBe(true);
    expect(tween.sampleAt(0).done).toBe(false);
  });

  it('同一进度多次求值结果稳定（纯函数语义）', () => {
    const tween = new CameraTween(START, END, TARGET_START, TARGET_START, 2000);
    const a = tween.sampleAt(731).position.toArray();
    expect(tween.sampleAt(731).position.toArray()).toEqual(a);

    const expectedEased = easeInOutCubic(731 / 2000);
    const expected = new THREE.Vector3().lerpVectors(START, END, expectedEased).toArray();
    expect(a).toEqual(expected);

    const anotherTween = new CameraTween(START, END, TARGET_START, TARGET_START, 2000);
    expect(anotherTween.sampleAt(731).position.toArray()).toEqual(a);
  });

  it('半程处 ease-in-out 插值恰为中点', () => {
    const tween = new CameraTween(START, END, TARGET_START, TARGET_START, 2000);
    const half = tween.sampleAt(1000);
    expect(easeInOutCubic(0.5)).toBe(0.5);
    expect(half.position.toArray()).toEqual([0, 2, 6]);
    expect(half.progress).toBe(0.5);
  });

  it('advance 累加与 sampleAt 结果一致，结束后标记 done', () => {
    const tween = new CameraTween(START, END, TARGET_START, TARGET_START, 2000);
    const first = tween.advance(500);
    expect(first.position.toArray()).toEqual(tween.sampleAt(500).position.toArray());
    const second = tween.advance(500);
    expect(second.position.toArray()).toEqual(tween.sampleAt(1000).position.toArray());
    expect(second.done).toBe(false);
    const rest = tween.advance(1000);
    expect(rest.done).toBe(true);
    expect(rest.position.toArray()).toEqual(END.toArray());
  });

  it('超时时长钳制到终点', () => {
    const tween = new CameraTween(START, END, TARGET_START, TARGET_START, 2000);
    expect(tween.sampleAt(99999).position.toArray()).toEqual(END.toArray());
    expect(tween.sampleAt(-10).position.toArray()).toEqual(START.toArray());
  });
});
