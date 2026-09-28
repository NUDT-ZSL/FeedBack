export class ObjectPool<T extends HTMLElement> {
  private pool: T[] = [];
  private createElement: () => T;

  constructor(createElement: () => T) {
    this.createElement = createElement;
  }

  acquire(): T {
    if (this.pool.length > 0) {
      const item = this.pool.pop();
      if (item !== undefined) {
        return item;
      }
    }
    return this.createElement();
  }

  release(item: T): void {
    item.remove();
    this.pool.push(item);
  }

  clear(): void {
    for (const item of this.pool) {
      item.remove();
    }
    this.pool = [];
  }

  get size(): number {
    return this.pool.length;
  }
}

export function createCardElement(): HTMLElement {
  const card = document.createElement('div');
  card.className = 'card';
  return card;
}

export const cardPool = new ObjectPool<HTMLElement>(createCardElement);
