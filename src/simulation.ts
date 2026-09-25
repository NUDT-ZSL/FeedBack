import { Ball } from './ball';
import { BrickManager } from './brick';
import { Paddle } from './paddle';

export interface GameWorld {
  ball: Ball;
  bricks: BrickManager;
  paddle: Paddle;
  canvasWidth: number;
  canvasHeight: number;
}

export interface FrameResult {
  ballFell: boolean;
  brickHit: boolean;
  comboChain: number;
  particlesCreated: number;
  progress: number;
}

export function stepGameWorld(world: GameWorld, deltaTime: number): FrameResult {
  const { ball, bricks, paddle, canvasWidth, canvasHeight } = world;

  paddle.update();

  const ballFell = ball.update(canvasWidth, canvasHeight);
  if (ballFell) {
    return {
      ballFell: true,
      brickHit: false,
      comboChain: 0,
      particlesCreated: 0,
      progress: bricks.getProgress()
    };
  }

  ball.checkPaddleCollision(paddle.x, paddle.y, paddle.width, paddle.height);

  const movingDownBeforeHit = ball.vy > 0;
  const collision = bricks.checkCollision(ball.x, ball.y, ball.radius);

  if (collision.hit) {
    ball.reflectVertical();
    ball.addRandomAngleOffset(movingDownBeforeHit ? 'vy-negative' : 'vy-positive');
  }

  bricks.updateParticles(deltaTime);

  return {
    ballFell: false,
    brickHit: collision.hit,
    comboChain: collision.comboChain,
    particlesCreated: collision.particles.length,
    progress: bricks.getProgress()
  };
}
