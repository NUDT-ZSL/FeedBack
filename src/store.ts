import type { ColorPalette } from './types';
import { saveAs } from 'file-saver';

type Listener = () => void;

class FavoriteStore {
  private favorites: ColorPalette[] = [];
  private listeners: Set<Listener> = new Set();

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    this.listeners.forEach((l) => l());
  }

  getFavorites(): ColorPalette[] {
    return [...this.favorites];
  }

  isFavorite(id: string): boolean {
    return this.favorites.some((p) => p.id === id);
  }

  addToFavorites(palette: ColorPalette): void {
    if (this.isFavorite(palette.id)) return;
    this.favorites.unshift({ ...palette, isFavorite: true });
    this.notify();
  }

  removeFromFavorites(id: string): void {
    const idx = this.favorites.findIndex((p) => p.id === id);
    if (idx !== -1) {
      this.favorites.splice(idx, 1);
      this.notify();
    }
  }

  toggleFavorite(palette: ColorPalette): boolean {
    if (this.isFavorite(palette.id)) {
      this.removeFromFavorites(palette.id);
      return false;
    } else {
      this.addToFavorites(palette);
      return true;
    }
  }

  exportToJSON(): void {
    const data = JSON.stringify(this.favorites, null, 2);
    const blob = new Blob([data], { type: 'application/json;charset=utf-8' });
    const fileName = `color-favorites-${new Date().toISOString().slice(0, 10)}.json`;
    saveAs(blob, fileName);
  }

  getById(id: string): ColorPalette | undefined {
    return this.favorites.find((p) => p.id === id);
  }
}

export const store = new FavoriteStore();
