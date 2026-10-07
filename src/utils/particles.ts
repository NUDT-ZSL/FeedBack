import confetti from 'canvas-confetti';

export function fireGoldConfetti(duration: number = 1000): void {
  const end = Date.now() + duration;
  const colors = ['#ffd700', '#ffec8b', '#ffb90f', '#daa520'];
  
  const frame = () => {
    confetti({
      particleCount: 6,
      angle: 60,
      spread: 55,
      origin: { x: 0, y: 0.7 },
      colors: colors,
      shapes: ['circle'],
      scalar: 0.8,
    });
    confetti({
      particleCount: 6,
      angle: 120,
      spread: 55,
      origin: { x: 1, y: 0.7 },
      colors: colors,
      shapes: ['circle'],
      scalar: 0.8,
    });
    
    if (Date.now() < end) {
      requestAnimationFrame(frame);
    }
  };
  frame();
}

export function fireEdgeSparkles(): void {
  const colors = ['#ffd700', '#ffec8b', '#ffb90f'];
  
  for (let side = 0; side < 4; side++) {
    const originX = side === 0 ? 0 : side === 2 ? 1 : Math.random();
    const originY = side === 1 ? 0 : side === 3 ? 1 : Math.random();
    
    confetti({
      particleCount: 15,
      angle: side * 90 + 45,
      spread: 90,
      origin: { x: originX, y: originY },
      colors: colors,
      shapes: ['circle', 'square'],
      scalar: 0.6,
      gravity: 0.8,
      ticks: 80,
    });
  }
}

export function fireCenterBurst(): void {
  const colors = ['#ffd700', '#ffec8b', '#ffb90f', '#daa520', '#b8860b'];
  
  confetti({
    particleCount: 50,
    spread: 360,
    origin: { x: 0.5, y: 0.5 },
    colors: colors,
    shapes: ['circle'],
    scalar: 1,
    gravity: 0.6,
    ticks: 120,
  });
}
