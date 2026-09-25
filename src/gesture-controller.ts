import { Hands, Results, NormalizedLandmark } from '@mediapipe/hands';
import type { GestureType } from './audio-visualizer';

type GestureCallback = (gesture: GestureType, fingerCount: number) => void;

const FINGER_TIPS = [4, 8, 12, 16, 20];
const FINGER_PIPS = [3, 6, 10, 14, 18];
const FINGER_MCPS = [2, 5, 9, 13, 17];

export class GestureController {
  private hands: Hands | null = null;
  private video: HTMLVideoElement | null = null;
  private stream: MediaStream | null = null;
  private gestureCallback: GestureCallback | null = null;
  private lastGesture: GestureType = 'none';
  private lastFingerCount = 0;
  private gestureHistory: GestureType[] = [];
  private stableFrames = 0;
  private currentStable: GestureType = 'none';
  private lastFireTime = 0;
  private fireCooldown = 650;
  private running = false;
  private onReadyCallback: (() => void) | null = null;
  private rafId: number | null = null;

  async init(videoElement: HTMLVideoElement): Promise<void> {
    this.video = videoElement;
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, facingMode: 'user' },
      audio: false
    });
    this.video.srcObject = this.stream;
    await new Promise<void>((resolve) => {
      this.video!.onloadedmetadata = () => resolve();
    });
    await this.video.play();
    this.hands = new Hands({
      locateFile: (file) => {
        return `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/${file}`;
      }
    });
    this.hands.setOptions({
      maxNumHands: 1,
      modelComplexity: 0,
      minDetectionConfidence: 0.6,
      minTrackingConfidence: 0.5
    });
    this.hands.onResults((results) => this.handleResults(results));
    await new Promise<void>((resolve) => {
      this.hands!.initialize().then(() => {
        this.onReadyCallback = resolve;
      });
    });
  }

  start(): void {
    if (this.running || !this.hands || !this.video) return;
    this.running = true;
    if (this.onReadyCallback) this.onReadyCallback();
    const loop = async () => {
      if (!this.running) return;
      try {
        if (this.video!.readyState >= 2) {
          await this.hands!.send({ image: this.video! });
        }
      } catch (e) {}
      this.rafId = requestAnimationFrame(loop);
    };
    loop();
  }

  stop(): void {
    this.running = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }
  }

  onGestureChange(callback: GestureCallback): void {
    this.gestureCallback = callback;
  }

  getLastGesture(): GestureType {
    return this.lastGesture;
  }

  private handleResults(results: Results): void {
    let gesture: GestureType = 'none';
    let fingerCount = 0;
    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
      const lm = results.multiHandLandmarks[0];
      fingerCount = this.countFingers(lm);
      gesture = this.classifyGesture(lm, fingerCount);
    }
    this.gestureHistory.push(gesture);
    if (this.gestureHistory.length > 5) this.gestureHistory.shift();
    const smoothed = this.majorityVote(this.gestureHistory);
    if (smoothed === this.currentStable) {
      this.stableFrames++;
    } else {
      this.currentStable = smoothed;
      this.stableFrames = 1;
    }
    const now = performance.now();
    const canFire = now - this.lastFireTime > this.fireCooldown;
    if (this.stableFrames >= 3 && this.currentStable !== 'none' && canFire && this.currentStable !== this.lastGesture) {
      this.lastGesture = this.currentStable;
      this.lastFireTime = now;
      if (this.gestureCallback) {
        let emitFinger = fingerCount;
        if (this.currentStable === 'fist') emitFinger = 0;
        if (this.currentStable === '1-finger') emitFinger = 1;
        if (this.currentStable === '2-finger') emitFinger = 2;
        if (this.currentStable === '3-finger') emitFinger = 3;
        if (this.currentStable === '4-finger') emitFinger = 4;
        if (this.currentStable === '5-finger') emitFinger = 5;
        this.gestureCallback(this.currentStable, emitFinger);
      }
    }
    if (smoothed === 'none') {
      this.lastGesture = 'none';
    }
  }

  private majorityVote(history: GestureType[]): GestureType {
    if (history.length === 0) return 'none';
    const counts: Record<string, number> = {};
    for (const g of history) counts[g] = (counts[g] || 0) + 1;
    let best: GestureType = history[history.length - 1];
    let bestCount = 0;
    for (const k of Object.keys(counts)) {
      if (counts[k] > bestCount) {
        bestCount = counts[k];
        best = k as GestureType;
      }
    }
    return best;
  }

  private countFingers(lm: NormalizedLandmark[]): number {
    let count = 0;
    const palmSize = this.distance(lm[0], lm[9]);
    if (palmSize < 0.01) return 0;
    for (let i = 1; i < 5; i++) {
      const tip = lm[FINGER_TIPS[i]];
      const pip = lm[FINGER_PIPS[i]];
      const mcp = lm[FINGER_MCPS[i]];
      const tipToPalm = this.distance(tip, lm[0]);
      const pipToPalm = this.distance(pip, lm[0]);
      const tipToMcp = this.distance(tip, mcp);
      const pipToMcp = this.distance(pip, mcp);
      if (tipToPalm > pipToPalm * 1.05 && tipToMcp > pipToMcp * 1.1) {
        count++;
      }
    }
    const thumbTip = lm[4];
    const thumbIp = lm[3];
    const thumbMcp = lm[2];
    const indexMcp = lm[5];
    const refX = indexMcp.x;
    const isRight = thumbTip.x > refX;
    let thumbExtended = false;
    if (isRight) {
      thumbExtended = thumbTip.x < thumbIp.x - 0.005 && thumbTip.x < thumbMcp.x - 0.005;
    } else {
      thumbExtended = thumbTip.x > thumbIp.x + 0.005 && thumbTip.x > thumbMcp.x + 0.005;
    }
    const tipToPalmT = this.distance(thumbTip, lm[0]);
    const mcpToPalmT = this.distance(thumbMcp, lm[0]);
    if (thumbExtended || tipToPalmT > mcpToPalmT * 1.25) {
      count++;
    }
    return count;
  }

  private classifyGesture(lm: NormalizedLandmark[], fingerCount: number): GestureType {
    const palmSize = this.distance(lm[0], lm[9]);
    if (palmSize < 0.03) return 'none';
    let isFist = true;
    for (let i = 1; i < 5; i++) {
      const tip = lm[FINGER_TIPS[i]];
      const mcp = lm[FINGER_MCPS[i]];
      const dist = this.distance(tip, lm[0]);
      const mcpDist = this.distance(mcp, lm[0]);
      if (dist > mcpDist * 1.15) {
        isFist = false;
        break;
      }
    }
    if (isFist && fingerCount <= 1) {
      const thumbTip = lm[4];
      const indexMcp = lm[5];
      const thumbClose = this.distance(thumbTip, indexMcp) < palmSize * 0.9;
      if (thumbClose || fingerCount === 0) return 'fist';
    }
    if (fingerCount === 0) return 'fist';
    if (fingerCount === 1) return '1-finger';
    if (fingerCount === 2) return '2-finger';
    if (fingerCount === 3) return '3-finger';
    if (fingerCount === 4) return '4-finger';
    if (fingerCount >= 5) return '5-finger';
    return 'none';
  }

  private distance(a: NormalizedLandmark, b: NormalizedLandmark): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const dz = (a.z || 0) - (b.z || 0);
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
}
