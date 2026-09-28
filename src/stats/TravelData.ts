import type { Continent } from './cityDB';

export interface City {
  id: string;
  name: string;
  country: string;
  continent: Continent;
  lat: number;
  lng: number;
  year: number;
  story: string;
  isRead: boolean;
  createdAt: number;
}

export interface Stats {
  total: number;
  countries: number;
  byYear: Record<number, number>;
  byContinent: Record<Continent, number>;
}

type Listener = () => void;

const STORAGE_KEY = 'travel-data-cities';

class TravelData {
  private static instance: TravelData | null = null;
  private cities: City[] = [];
  private listeners: Set<Listener> = new Set();
  private persist: boolean;

  private constructor(persist: boolean = true) {
    this.persist = persist;
    if (persist) {
      this.loadFromStorage();
    }
  }

  public static getInstance(persist: boolean = true): TravelData {
    if (!TravelData.instance) {
      TravelData.instance = new TravelData(persist);
    }
    return TravelData.instance;
  }

  private loadFromStorage(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        this.cities = JSON.parse(raw) as City[];
      }
    } catch (e) {
      this.cities = [];
    }
  }

  private saveToStorage(): void {
    if (this.persist) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.cities));
      } catch (e) {
        // ignore
      }
    }
  }

  private notify(): void {
    this.listeners.forEach((listener) => listener());
  }

  public subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.unsubscribe(listener);
  }

  public unsubscribe(listener: Listener): void {
    this.listeners.delete(listener);
  }

  public getCities(): City[] {
    return [...this.cities];
  }

  public getCityById(id: string): City | undefined {
    return this.cities.find((c) => c.id === id);
  }

  public addCity(city: Omit<City, 'id' | 'createdAt'>): City {
    const newCity: City = {
      ...city,
      id: crypto.randomUUID(),
      createdAt: Date.now(),
    };
    this.cities.push(newCity);
    this.saveToStorage();
    this.notify();
    return newCity;
  }

  public updateCity(id: string, updates: Partial<Omit<City, 'id' | 'createdAt'>>): City | undefined {
    const index = this.cities.findIndex((c) => c.id === id);
    if (index === -1) return undefined;
    const updated = { ...this.cities[index], ...updates };
    this.cities[index] = updated;
    this.saveToStorage();
    this.notify();
    return updated;
  }

  public deleteCity(id: string): boolean {
    const index = this.cities.findIndex((c) => c.id === id);
    if (index === -1) return false;
    this.cities.splice(index, 1);
    this.saveToStorage();
    this.notify();
    return true;
  }

  public getStats(): Stats {
    const total = this.cities.length;
    const countries = new Set(this.cities.map((c) => c.country)).size;

    const byYear: Record<number, number> = {};
    const byContinent: Record<Continent, number> = {
      Asia: 0,
      Europe: 0,
      'North America': 0,
      'South America': 0,
      Africa: 0,
      Oceania: 0,
    };

    for (const city of this.cities) {
      byYear[city.year] = (byYear[city.year] || 0) + 1;
      byContinent[city.continent] = (byContinent[city.continent] || 0) + 1;
    }

    return { total, countries, byYear, byContinent };
  }
}

export default TravelData;
