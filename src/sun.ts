import { Season, SunPosition } from './types';

const LATITUDE = 39.9; 

const SEASON_DECLINATION: Record<Season, number> = {
  spring: 0,
  summer: 23.44,
  autumn: 0,
  winter: -23.44
};

export class Sun {
  private season: Season = 'autumn';
  private timeOfDay: number = 12;
  private targetSeason: Season = 'autumn';
  private targetTime: number = 12;
  private transitionProgress: number = 1;
  private transitionDuration: number = 2;
  private isTransitioning: boolean = false;

  private startDeclination: number = 0;
  private endDeclination: number = 0;
  private startTime: number = 12;
  private endTime: number = 12;

  constructor(initialSeason: Season = 'autumn', initialTime: number = 12) {
    this.season = initialSeason;
    this.timeOfDay = initialTime;
    this.targetSeason = initialSeason;
    this.targetTime = initialTime;
    this.transitionProgress = 1;
  }

  public setSeason(season: Season, animate: boolean = true): void {
    if (season === this.targetSeason && this.transitionProgress >= 1) return;
    
    if (animate) {
      this.startDeclination = this.getCurrentDeclination();
      this.endDeclination = SEASON_DECLINATION[season];
      this.startTime = this.timeOfDay;
      this.endTime = this.targetTime;
      this.targetSeason = season;
      this.transitionProgress = 0;
      this.isTransitioning = true;
    } else {
      this.season = season;
      this.targetSeason = season;
      this.transitionProgress = 1;
      this.isTransitioning = false;
    }
  }

  public setTime(time: number): void {
    time = Math.max(6, Math.min(18, time));
    this.targetTime = time;
    if (!this.isTransitioning) {
      this.timeOfDay = time;
    } else {
      this.endTime = time;
    }
  }

  public update(deltaTime: number): SunPosition {
    if (this.isTransitioning && this.transitionProgress < 1) {
      this.transitionProgress += deltaTime / this.transitionDuration;
      if (this.transitionProgress >= 1) {
        this.transitionProgress = 1;
        this.isTransitioning = false;
        this.season = this.targetSeason;
        this.timeOfDay = this.targetTime;
      } else {
        const t = this.lerp(this.startTime, this.endTime, this.transitionProgress);
        this.timeOfDay = t;
      }
    } else if (!this.isTransitioning && Math.abs(this.timeOfDay - this.targetTime) > 0.001) {
      this.timeOfDay += (this.targetTime - this.timeOfDay) * Math.min(deltaTime * 10, 1);
      if (Math.abs(this.timeOfDay - this.targetTime) < 0.001) {
        this.timeOfDay = this.targetTime;
      }
    }

    return this.calculatePosition();
  }

  private getCurrentDeclination(): number {
    if (this.isTransitioning) {
      return this.lerp(this.startDeclination, this.endDeclination, this.transitionProgress);
    }
    return SEASON_DECLINATION[this.season];
  }

  private calculatePosition(): SunPosition {
    const declination = this.getCurrentDeclination();
    const hourAngle = (this.timeOfDay - 12) * 15;

    const latRad = this.toRadians(LATITUDE);
    const decRad = this.toRadians(declination);
    const haRad = this.toRadians(hourAngle);

    const sinElevation = 
      Math.sin(latRad) * Math.sin(decRad) + 
      Math.cos(latRad) * Math.cos(decRad) * Math.cos(haRad);
    
    const elevationRad = Math.asin(Math.max(-1, Math.min(1, sinElevation)));
    const elevation = this.toDegrees(elevationRad);

    let azimuth = 180;
    if (elevation > -90 && elevation < 90) {
      const cosAz = 
        (Math.sin(decRad) - Math.sin(latRad) * sinElevation) / 
        (Math.cos(latRad) * Math.cos(elevationRad));
      const cosAzClamped = Math.max(-1, Math.min(1, cosAz));
      azimuth = this.toDegrees(Math.acos(cosAzClamped));
      if (this.timeOfDay < 12) {
        azimuth = 360 - azimuth;
      }
    }

    const elevRad = this.toRadians(elevation);
    const azRad = this.toRadians(azimuth);
    
    const direction = {
      x: Math.sin(azRad) * Math.cos(elevRad),
      y: Math.sin(elevRad),
      z: Math.cos(azRad) * Math.cos(elevRad)
    };

    return { elevation, azimuth, direction };
  }

  public getSunPathPoints(season: Season, points: number = 36): { x: number; y: number }[] {
    const result: { x: number; y: number }[] = [];
    const declination = SEASON_DECLINATION[season];
    const decRad = this.toRadians(declination);
    const latRad = this.toRadians(LATITUDE);

    for (let i = 0; i <= points; i++) {
      const hour = 6 + (12 * i) / points;
      const hourAngle = (hour - 12) * 15;
      const haRad = this.toRadians(hourAngle);

      const sinElevation = 
        Math.sin(latRad) * Math.sin(decRad) + 
        Math.cos(latRad) * Math.cos(decRad) * Math.cos(haRad);
      
      const elevationRad = Math.asin(Math.max(-1, Math.min(1, sinElevation)));
      const elevation = this.toDegrees(elevationRad);

      if (elevation < 0) continue;

      const cosAz = 
        (Math.sin(decRad) - Math.sin(latRad) * sinElevation) / 
        (Math.cos(latRad) * Math.cos(elevationRad));
      const cosAzClamped = Math.max(-1, Math.min(1, cosAz));
      let azimuth = this.toDegrees(Math.acos(cosAzClamped));
      if (hour < 12) {
        azimuth = 360 - azimuth;
      }

      const r = (90 - elevation) / 90;
      const theta = this.toRadians(azimuth - 90);
      result.push({
        x: 0.5 + r * Math.cos(theta) * 0.45,
        y: 0.5 + r * Math.sin(theta) * 0.45
      });
    }
    return result;
  }

  public getCurrentSeason(): Season {
    return this.isTransitioning ? this.targetSeason : this.season;
  }

  public getCurrentTime(): number {
    return this.timeOfDay;
  }

  public isInTransition(): boolean {
    return this.isTransitioning;
  }

  private lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
  }

  private toRadians(degrees: number): number {
    return (degrees * Math.PI) / 180;
  }

  private toDegrees(radians: number): number {
    return (radians * 180) / Math.PI;
  }
}
