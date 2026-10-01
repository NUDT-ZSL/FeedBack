import * as THREE from 'three';
import { Star } from './star';

export interface OrbitParams {
  semiMajorAxis: number;
  eccentricity: number;
  inclination: number;
  period: number;
  trueAnomaly: number;
}

export class Orbit {
  public line: THREE.Line;
  public labelSprite: THREE.Sprite;
  public star: Star;
  public otherStar: Star;
  private params: OrbitParams;
  private targetParams: OrbitParams;
  private baseInclination: number;
  private baseEccentricity: number;
  private baseSemiMajorAxis: number;
  private perturbationAmount: number;
  private time: number;

  constructor(star: Star, otherStar: Star, semiMajorAxis: number, inclination: number) {
    this.star = star;
    this.otherStar = otherStar;
    this.baseSemiMajorAxis = semiMajorAxis;
    this.baseInclination = inclination;
    this.baseEccentricity = 0.15;
    this.time = Math.random() * Math.PI * 2;
    this.perturbationAmount = 0;

    const period = this.calculatePeriod(star.config.mass, semiMajorAxis);

    this.params = {
      semiMajorAxis: semiMajorAxis,
      eccentricity: this.baseEccentricity,
      inclination: inclination,
      period: period,
      trueAnomaly: Math.random() * Math.PI * 2
    };

    this.targetParams = { ...this.params };

    this.line = this.createOrbitLine(star.config.color);
    this.labelSprite = this.createLabel(star.config.color);

    this.updateGeometry();
  }

  private calculatePeriod(mass: number, semiMajorAxis: number): number {
    return Math.sqrt((semiMajorAxis * semiMajorAxis * semiMajorAxis) / Math.max(mass, 0.1)) * 2;
  }

  private createOrbitLine(color: number): THREE.Line {
    const geometry = new THREE.BufferGeometry();
    const segments = 128;
    const positions = new Float32Array(segments * 3);
    const colors = new Float32Array(segments * 3);
    const opacities = new Float32Array(segments);

    const c = new THREE.Color(color);

    for (let i = 0; i < segments; i++) {
      positions[i * 3] = 0;
      positions[i * 3 + 1] = 0;
      positions[i * 3 + 2] = 0;

      const t = i / segments;
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
      opacities[i] = 0.15 + t * 0.4;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    const line = new THREE.Line(geometry, material);
    return line;
  }

  private createLabel(color: number): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;

    const c = new THREE.Color(color);
    ctx.fillStyle = `rgba(${c.r * 255}, ${c.g * 255}, ${c.b * 255}, 0.9)`;
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('轨道信息', 128, 40);

    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      opacity: 0.8,
      depthWrite: false
    });

    const sprite = new THREE.Sprite(material);
    sprite.scale.set(4, 1, 1);
    sprite.visible = false;
    return sprite;
  }

  public updateMass(mass: number): void {
    this.targetParams.period = this.calculatePeriod(mass, this.targetParams.semiMajorAxis);
    this.targetParams.semiMajorAxis = this.baseSemiMajorAxis * (1 + (mass - 3) * 0.08);
  }

  public updateGeometry(): void {
    const positions = this.line.geometry.getAttribute('position') as THREE.BufferAttribute;
    const segments = positions.count;

    const axis = new THREE.Vector3(1, 0, 0);
    const rotation = new THREE.Quaternion().setFromAxisAngle(axis, this.params.inclination);

    for (let i = 0; i < segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      const r = this.params.semiMajorAxis * (1 - this.params.eccentricity * this.params.eccentricity) /
        (1 + this.params.eccentricity * Math.cos(angle));

      const pos = new THREE.Vector3(
        r * Math.cos(angle),
        0,
        r * Math.sin(angle)
      );
      pos.applyQuaternion(rotation);

      positions.setXYZ(i, pos.x, pos.y, pos.z);
    }

    positions.needsUpdate = true;
    this.line.geometry.computeBoundingSphere();
  }

  public setVisible(visible: boolean): void {
    this.line.visible = visible;
  }

  public update(deltaTime: number, speedMultiplier: number): void {
    const lerpFactor = Math.min(deltaTime * 2, 1);

    this.params.semiMajorAxis += (this.targetParams.semiMajorAxis - this.params.semiMajorAxis) * lerpFactor;
    this.params.eccentricity += (this.targetParams.eccentricity - this.params.eccentricity) * lerpFactor;
    this.params.inclination += (this.targetParams.inclination - this.params.inclination) * lerpFactor;
    this.params.period += (this.targetParams.period - this.params.period) * lerpFactor;

    const starDistance = this.star.group.position.distanceTo(this.otherStar.group.position);
    const perturbationThreshold = 10;
    const perturbationStrength = Math.max(0, 1 - starDistance / perturbationThreshold) * 0.5;
    this.perturbationAmount += (perturbationStrength - this.perturbationAmount) * lerpFactor;

    this.time += deltaTime;
    const dynamicEccentricity = this.baseEccentricity + Math.sin(this.time * 2) * this.perturbationAmount * 0.3;
    const dynamicInclination = this.baseInclination + Math.sin(this.time * 1.5) * this.perturbationAmount * 0.3;

    this.params.eccentricity += (dynamicEccentricity - this.params.eccentricity) * lerpFactor;
    this.params.inclination += (dynamicInclination - this.params.inclination) * lerpFactor;

    const angularVelocity = (Math.PI * 2) / Math.max(this.params.period, 0.1) * speedMultiplier;
    this.params.trueAnomaly += angularVelocity * deltaTime;
    if (this.params.trueAnomaly > Math.PI * 2) {
      this.params.trueAnomaly -= Math.PI * 2;
    }

    this.updateGeometry();

    const r = this.params.semiMajorAxis * (1 - this.params.eccentricity * this.params.eccentricity) /
      (1 + this.params.eccentricity * Math.cos(this.params.trueAnomaly));

    const axis = new THREE.Vector3(1, 0, 0);
    const rotation = new THREE.Quaternion().setFromAxisAngle(axis, this.params.inclination);

    const planetPos = new THREE.Vector3(
      r * Math.cos(this.params.trueAnomaly),
      0,
      r * Math.sin(this.params.trueAnomaly)
    );
    planetPos.applyQuaternion(rotation);

    this.star.planet.position.copy(planetPos);
    this.star.planetGlow.position.copy(planetPos);

    const labelPos = planetPos.clone().normalize().multiplyScalar(this.params.semiMajorAxis * 1.1);
    labelPos.y += 0.5;
    this.labelSprite.position.copy(labelPos);
  }
}
