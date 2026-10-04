import type { UIPort, UIViewState } from '../src/contracts';

/** 无头 UI：记录每次 render 的视图状态，供断言与观察。 */
export class HeadlessUI implements UIPort {
  readonly renders: UIViewState[] = [];
  private errorCount: number = 0;

  render(state: UIViewState): void {
    this.renders.push({ ...state });
  }

  notifyUploadError(_error: unknown): void {
    this.errorCount++;
  }

  get last(): UIViewState {
    return this.renders[this.renders.length - 1];
  }

  get uploadErrorCount(): number {
    return this.errorCount;
  }
}
