import Phaser from 'phaser';
import { GameScene } from './scene/GameScene';
import { NetworkManager } from './network/NetworkManager';

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'game-container',
  backgroundColor: '#1a1a2e',
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: window.innerWidth,
    height: window.innerHeight
  },
  scene: [GameScene],
  pixelArt: true,
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { x: 0, y: 0 },
      debug: false
    }
  },
  input: {
    activePointers: 3
  }
};

const game = new Phaser.Game(config);
const networkManager = new NetworkManager();

game.events.once('ready', () => {
  const gameScene = game.scene.getScene('GameScene') as GameScene;
  if (gameScene) {
    gameScene.setNetworkManager(networkManager);
  }
});

export { game, networkManager };
