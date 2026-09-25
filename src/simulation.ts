// Headless, deterministic simulation of a full mini-golf round.
//
// This mirrors the stroke / game-state logic of the `Game` class in
// main.ts (strike -> rolling -> win/fail/aiming) without any DOM, canvas
// or requestAnimationFrame, so the complete chain from a stroke to the
// ball resting or dropping into the hole can be verified offline.
//
// Determinism: the course layout and slope deviation randomness are
// driven by the seedable source in rng.ts. Given the same seed, canvas
// size, stroke sequence and deltaTime, every run produces bit-identical
// results.

import { Ball, Vector2 } from './ball';
import { Course } from './course';
import { seedRandom, resetRandomSource } from './rng';

/** Maximum strokes before the game is lost (mirrors Game.maxStrokes). */
export const MAX_STROKES = 10;

/** Fixed physics step used by the simulation (60 FPS frame). */
export const FIXED_DELTA = 1 / 60;

export type GameState = 'aiming' | 'rolling' | 'win' | 'fail';

export interface Stroke {
  direction: Vector2;
  power: number;
}

export interface StrokeResult {
  /** 1-based stroke number. */
  stroke: number;
  endPosition: Vector2;
  isInHole: boolean;
  /** Physics steps taken until the ball stopped or dropped. */
  steps: number;
}

export interface CourseSummary {
  width: number;
  height: number;
  teePosition: Vector2;
  holePosition: Vector2;
  holeRadius: number;
  terrainZones: Array<{
    type: string;
    center: Vector2;
    radius: number;
    slopeAngle?: number;
    slopeDirection?: Vector2;
  }>;
  fenceCount: number;
}

export interface SimulationResult {
  finalPosition: Vector2;
  isInHole: boolean;
  strokeCount: number;
  maxStrokes: number;
  gameState: GameState;
  strokes: StrokeResult[];
  course: CourseSummary;
}

export interface SimulationOptions {
  /** Seed for course generation and slope deviation randomness. */
  seed: number;
  width?: number;
  height?: number;
  maxStrokes?: number;
  deltaTime?: number;
  /** Safety cap on physics steps per stroke (default 100000). */
  maxStepsPerStroke?: number;
}

function summarizeCourse(course: Course): CourseSummary {
  return {
    width: course.width,
    height: course.height,
    teePosition: { ...course.teePosition },
    holePosition: { ...course.holePosition },
    holeRadius: course.holeRadius,
    terrainZones: course.terrainZones.map((zone) => ({
      type: zone.type,
      center: { ...zone.center },
      radius: zone.radius,
      slopeAngle: zone.slopeAngle,
      slopeDirection: zone.slopeDirection ? { ...zone.slopeDirection } : undefined
    })),
    fenceCount: course.fences.length
  };
}

/**
 * Runs a full round: generates a course from the seed, then plays the
 * given strokes in order. After each stroke the ball is simulated with a
 * fixed time step until it stops or drops into the hole. The round ends
 * early on 'win' (ball in hole) or 'fail' (stroke limit reached).
 */
export function simulateGame(strokes: Stroke[], options: SimulationOptions): SimulationResult {
  const width = options.width ?? 1280;
  const height = options.height ?? 720;
  const maxStrokes = options.maxStrokes ?? MAX_STROKES;
  const deltaTime = options.deltaTime ?? FIXED_DELTA;
  const maxSteps = options.maxStepsPerStroke ?? 100000;

  seedRandom(options.seed);
  try {
    const course = new Course(width, height);
    const ball = new Ball(course.teePosition.x, course.teePosition.y);

    let gameState: GameState = 'aiming';
    let strokeCount = 0;
    const strokeResults: StrokeResult[] = [];

    for (const stroke of strokes) {
      if (gameState !== 'aiming') break;

      ball.applyForce(stroke.direction, stroke.power);
      strokeCount++;
      gameState = 'rolling';

      let steps = 0;
      while (ball.isMoving && !ball.isInHole && steps < maxSteps) {
        ball.update(
          deltaTime,
          course.terrainZones,
          course.fences,
          course.holePosition,
          course.holeRadius
        );
        steps++;
      }

      strokeResults.push({
        stroke: strokeCount,
        endPosition: { ...ball.position },
        isInHole: ball.isInHole,
        steps
      });

      // Same precedence as Game.update: a holed ball wins even on the
      // final allowed stroke; otherwise the stroke limit means failure.
      if (ball.isInHole) {
        gameState = 'win';
      } else if (strokeCount >= maxStrokes) {
        gameState = 'fail';
      } else {
        gameState = 'aiming';
      }
    }

    return {
      finalPosition: { ...ball.position },
      isInHole: ball.isInHole,
      strokeCount,
      maxStrokes,
      gameState,
      strokes: strokeResults,
      course: summarizeCourse(course)
    };
  } finally {
    resetRandomSource();
  }
}
