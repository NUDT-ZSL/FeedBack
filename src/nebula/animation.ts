export class NebulaAnimation {
  private rotationAngle = 0;
  private elapsedTime = 0;

  advance(delta: number, rotationSpeed: number): void {
    this.rotationAngle += rotationSpeed * delta;
    this.elapsedTime += delta;
  }

  get rotation(): number {
    return this.rotationAngle;
  }

  get time(): number {
    return this.elapsedTime;
  }
}
