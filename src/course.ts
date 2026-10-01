import { Vector2, Fence, TerrainZone } from './ball';

export class Course {
  width: number;
  height: number;
  terrainZones: TerrainZone[];
  fences: Fence[];
  holePosition: Vector2;
  holeRadius: number;
  teePosition: Vector2;
  private sandOffset: number;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.terrainZones = [];
    this.fences = [];
    this.holePosition = { x: 0, y: 0 };
    this.holeRadius = 18;
    this.teePosition = { x: 0, y: 0 };
    this.sandOffset = 0;
    this.generate();
  }

  generate(): void {
    this.terrainZones = [];
    this.fences = [];

    const margin = 80;
    const innerHeight = this.height - margin * 2;

    this.teePosition = {
      x: margin + 80 + Math.random() * 60,
      y: margin + innerHeight / 2 + (Math.random() - 0.5) * 150
    };

    this.holePosition = {
      x: this.width - margin - 80 - Math.random() * 60,
      y: margin + innerHeight / 2 + (Math.random() - 0.5) * 150
    };

    const centerX = (this.teePosition.x + this.holePosition.x) / 2;
    const centerY = (this.teePosition.y + this.holePosition.y) / 2;

    const zoneCount = 3 + Math.floor(Math.random() * 3);
    const types: Array<'sand' | 'uphill' | 'downhill'> = ['sand', 'uphill', 'downhill'];

    for (let i = 0; i < zoneCount; i++) {
      const type = types[Math.floor(Math.random() * types.length)];
      const angle = Math.random() * Math.PI * 2;
      const dist = 100 + Math.random() * 200;
      const zoneX = centerX + Math.cos(angle) * dist;
      const zoneY = centerY + Math.sin(angle) * dist;

      const clampedX = Math.max(margin + 60, Math.min(this.width - margin - 60, zoneX));
      const clampedY = Math.max(margin + 60, Math.min(this.height - margin - 60, zoneY));

      const distToTee = Math.sqrt(
        Math.pow(clampedX - this.teePosition.x, 2) +
        Math.pow(clampedY - this.teePosition.y, 2)
      );
      const distToHole = Math.sqrt(
        Math.pow(clampedX - this.holePosition.x, 2) +
        Math.pow(clampedY - this.holePosition.y, 2)
      );

      if (distToTee < 60 || distToHole < 80) continue;

      const zone: TerrainZone = {
        type,
        center: { x: clampedX, y: clampedY },
        radius: 50 + Math.random() * 60
      };

      if (type === 'uphill' || type === 'downhill') {
        zone.slopeAngle = 0.2 + Math.random() * 0.3;
        const slopeAngle = Math.random() * Math.PI * 2;
        zone.slopeDirection = {
          x: Math.cos(slopeAngle),
          y: Math.sin(slopeAngle)
        };
      }

      this.terrainZones.push(zone);
    }

    this.createFences(margin);
  }

  private createFences(margin: number): void {
    const fencePoints: Vector2[] = [];
    const segments = 16;

    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const x = margin + t * (this.width - margin * 2);
      const yOffset = Math.sin(t * Math.PI * 2) * 20;
      fencePoints.push({ x, y: margin + yOffset });
    }

    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const x = this.width - margin - t * (this.width - margin * 2);
      const yOffset = Math.sin(t * Math.PI * 2 + Math.PI) * 20;
      fencePoints.push({ x, y: this.height - margin + yOffset });
    }

    for (let i = 0; i < fencePoints.length; i++) {
      const p1 = fencePoints[i];
      const p2 = fencePoints[(i + 1) % fencePoints.length];

      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      const normalX = -dy / len;
      const normalY = dx / len;

      const midX = (p1.x + p2.x) / 2;
      const midY = (p1.y + p2.y) / 2;
      const centerX = this.width / 2;
      const centerY = this.height / 2;

      const toCenterX = centerX - midX;
      const toCenterY = centerY - midY;
      const dot = normalX * toCenterX + normalY * toCenterY;

      const fence: Fence = {
        start: p1,
        end: p2,
        normal: {
          x: dot > 0 ? normalX : -normalX,
          y: dot > 0 ? normalY : -normalY
        }
      };

      this.fences.push(fence);
    }
  }

  update(deltaTime: number): void {
    this.sandOffset = (this.sandOffset + deltaTime * 30) % 20;
  }

  render(ctx: CanvasRenderingContext2D, tiltAngle: number): void {
    ctx.save();
    ctx.scale(1, Math.cos(tiltAngle));

    this.renderGrass(ctx);
    this.renderTerrainZones(ctx);
    this.renderHole(ctx);
    this.renderTee(ctx);
    this.renderFences(ctx);

    ctx.restore();
  }

  private renderGrass(ctx: CanvasRenderingContext2D): void {
    const gradient = ctx.createLinearGradient(0, 0, 0, this.height);
    gradient.addColorStop(0, '#5cb85c');
    gradient.addColorStop(0.5, '#4CAF50');
    gradient.addColorStop(1, '#3d8b3d');

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, this.width, this.height);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.03)';
    for (let i = 0; i < 200; i++) {
      const x = Math.random() * this.width;
      const y = Math.random() * this.height;
      const size = 2 + Math.random() * 3;
      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private renderTerrainZones(ctx: CanvasRenderingContext2D): void {
    for (const zone of this.terrainZones) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(zone.center.x, zone.center.y, zone.radius, 0, Math.PI * 2);

      switch (zone.type) {
        case 'sand':
          this.renderSand(ctx, zone);
          break;
        case 'uphill':
          this.renderSlope(ctx, zone, true);
          break;
        case 'downhill':
          this.renderSlope(ctx, zone, false);
          break;
      }

      ctx.restore();
    }
  }

  private renderSand(ctx: CanvasRenderingContext2D, zone: TerrainZone): void {
    const gradient = ctx.createRadialGradient(
      zone.center.x, zone.center.y, 0,
      zone.center.x, zone.center.y, zone.radius
    );
    gradient.addColorStop(0, '#F5DEB3');
    gradient.addColorStop(0.7, '#DEB887');
    gradient.addColorStop(1, '#D2B48C');

    ctx.fillStyle = gradient;
    ctx.fill();

    ctx.save();
    ctx.clip();
    ctx.fillStyle = 'rgba(139, 119, 101, 0.3)';

    for (let i = 0; i < 50; i++) {
      const baseX = zone.center.x - zone.radius + (i / 50) * zone.radius * 2;
      for (let j = 0; j < 5; j++) {
        const x = baseX + Math.sin(this.sandOffset + j * 4) * 3;
        const y = zone.center.y - zone.radius + ((i * 5 + j) % 50) / 50 * zone.radius * 2 + this.sandOffset * 0.5;
        const wrappedY = ((y - (zone.center.y - zone.radius)) % (zone.radius * 2)) + zone.center.y - zone.radius;
        ctx.beginPath();
        ctx.arc(x, wrappedY, 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();

    ctx.strokeStyle = 'rgba(139, 119, 101, 0.5)';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  private renderSlope(ctx: CanvasRenderingContext2D, zone: TerrainZone, isUphill: boolean): void {
    const baseColor = isUphill ? '#6B8E23' : '#90EE90';
    const edgeColor = isUphill ? '#556B2F' : '#7CCD7C';

    const gradient = ctx.createRadialGradient(
      zone.center.x, zone.center.y, 0,
      zone.center.x, zone.center.y, zone.radius
    );
    gradient.addColorStop(0, baseColor);
    gradient.addColorStop(1, edgeColor);

    ctx.fillStyle = gradient;
    ctx.fill();

    if (zone.slopeDirection) {
      ctx.save();
      ctx.clip();
      ctx.translate(zone.center.x, zone.center.y);
      ctx.rotate(Math.atan2(zone.slopeDirection.y, zone.slopeDirection.x));

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
      ctx.lineWidth = 2;

      const arrowCount = 5;
      for (let i = 0; i < arrowCount; i++) {
        const offsetY = (i - arrowCount / 2) * 25;
        const startX = isUphill ? zone.radius * 0.6 : -zone.radius * 0.6;
        const endX = isUphill ? -zone.radius * 0.6 : zone.radius * 0.6;

        ctx.beginPath();
        ctx.moveTo(startX, offsetY);
        ctx.lineTo(endX, offsetY);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(endX, offsetY);
        ctx.lineTo(endX - 8 * (isUphill ? -1 : 1), offsetY - 5);
        ctx.moveTo(endX, offsetY);
        ctx.lineTo(endX - 8 * (isUphill ? -1 : 1), offsetY + 5);
        ctx.stroke();
      }

      ctx.restore();
    }

    ctx.strokeStyle = isUphill ? 'rgba(85, 107, 47, 0.8)' : 'rgba(124, 205, 124, 0.8)';
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  private renderHole(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.beginPath();
    ctx.ellipse(this.holePosition.x + 3, this.holePosition.y + 3, this.holeRadius + 2, this.holeRadius + 2, 0, 0, Math.PI * 2);
    ctx.fill();

    const holeGradient = ctx.createRadialGradient(
      this.holePosition.x, this.holePosition.y, 0,
      this.holePosition.x, this.holePosition.y, this.holeRadius
    );
    holeGradient.addColorStop(0, '#1a1a1a');
    holeGradient.addColorStop(0.7, '#0d0d0d');
    holeGradient.addColorStop(1, '#000000');

    ctx.fillStyle = holeGradient;
    ctx.beginPath();
    ctx.arc(this.holePosition.x, this.holePosition.y, this.holeRadius, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#8B4513';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(this.holePosition.x, this.holePosition.y, this.holeRadius + 2, 0, Math.PI * 2);
    ctx.stroke();

    const flagX = this.holePosition.x;
    const flagY = this.holePosition.y - this.holeRadius;

    ctx.fillStyle = '#8B4513';
    ctx.fillRect(flagX - 2, flagY - 60, 4, 60);

    ctx.fillStyle = '#FF4444';
    ctx.beginPath();
    ctx.moveTo(flagX + 2, flagY - 60);
    ctx.lineTo(flagX + 35, flagY - 50);
    ctx.lineTo(flagX + 2, flagY - 40);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = '#CC0000';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  private renderTee(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.beginPath();
    ctx.arc(this.teePosition.x, this.teePosition.y, 25, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#4CAF50';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.arc(this.teePosition.x, this.teePosition.y, 25, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = '#4CAF50';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('TEE', this.teePosition.x, this.teePosition.y);
  }

  private renderFences(ctx: CanvasRenderingContext2D): void {
    for (const fence of this.fences) {
      this.renderWoodenFence(ctx, fence.start, fence.end);
    }
  }

  private renderWoodenFence(ctx: CanvasRenderingContext2D, start: Vector2, end: Vector2): void {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.sqrt(dx * dx + dy * dy);
    const angle = Math.atan2(dy, dx);

    ctx.save();
    ctx.translate(start.x, start.y);
    ctx.rotate(angle);

    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.fillRect(0, 2, length, 18);

    const woodGradient = ctx.createLinearGradient(0, 0, 0, 16);
    woodGradient.addColorStop(0, '#A0522D');
    woodGradient.addColorStop(0.3, '#8B4513');
    woodGradient.addColorStop(0.7, '#8B4513');
    woodGradient.addColorStop(1, '#654321');

    ctx.fillStyle = woodGradient;
    ctx.fillRect(0, 0, length, 16);

    ctx.strokeStyle = 'rgba(0, 0, 0, 0.2)';
    ctx.lineWidth = 1;
    const plankWidth = 20;
    for (let x = 0; x < length; x += plankWidth) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, 16);
      ctx.stroke();
    }

    ctx.fillStyle = 'rgba(139, 90, 43, 0.6)';
    for (let x = 5; x < length; x += plankWidth) {
      for (let y = 3; y < 16; y += 6) {
        ctx.beginPath();
        ctx.arc(x, y, 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.restore();
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.generate();
  }
}
