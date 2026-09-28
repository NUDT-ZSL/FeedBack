import type { Movie, UserMovie, WatchStatus } from '@/types';
import moviesData from '@/data/movies.json';

const STORAGE_KEY = 'cinecollect_user_movies';

class MovieManager {
  private static instance: MovieManager;
  private movies: Movie[] = [];
  private userMovies: Map<string, UserMovie> = new Map();
  private searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  private constructor() {
    this.loadMovies();
    this.loadUserMovies();
  }

  public static getInstance(): MovieManager {
    if (!MovieManager.instance) {
      MovieManager.instance = new MovieManager();
    }
    return MovieManager.instance;
  }

  private loadMovies(): void {
    this.movies = moviesData as Movie[];
  }

  private loadUserMovies(): void {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as UserMovie[];
        parsed.forEach((userMovie) => {
          this.userMovies.set(userMovie.movieId, userMovie);
        });
      }
    } catch (error) {
      console.error('Failed to load user movies:', error);
    }
  }

  private saveUserMovies(): void {
    try {
      const data = Array.from(this.userMovies.values());
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (error) {
      console.error('Failed to save user movies:', error);
    }
  }

  public getAllMovies(): Movie[] {
    return [...this.movies];
  }

  public getMovieById(id: string): Movie | undefined {
    return this.movies.find((movie) => movie.id === id);
  }

  public searchMovies(
    query: string,
    callback: (results: Movie[]) => void,
    debounceMs: number = 200
  ): void {
    if (this.searchDebounceTimer) {
      clearTimeout(this.searchDebounceTimer);
    }

    this.searchDebounceTimer = setTimeout(() => {
      const lowerQuery = query.trim().toLowerCase();
      if (!lowerQuery) {
        callback([]);
        return;
      }

      const results = this.movies.filter(
        (movie) =>
          movie.title.toLowerCase().includes(lowerQuery) ||
          movie.director.toLowerCase().includes(lowerQuery)
      );
      callback(results);
    }, debounceMs);
  }

  public addFavorite(movieId: string, status: WatchStatus = 'want_to_watch'): void {
    if (this.userMovies.has(movieId)) {
      return;
    }

    const userMovie: UserMovie = {
      movieId,
      status,
      rating: 0,
      addedAt: new Date().toISOString(),
    };

    this.userMovies.set(movieId, userMovie);
    this.saveUserMovies();
  }

  public removeFavorite(movieId: string): void {
    this.userMovies.delete(movieId);
    this.saveUserMovies();
  }

  public updateStatus(movieId: string, status: WatchStatus): void {
    const userMovie = this.userMovies.get(movieId);
    if (!userMovie) {
      return;
    }

    userMovie.status = status;
    this.saveUserMovies();
  }

  public updateRating(movieId: string, rating: number): void {
    const userMovie = this.userMovies.get(movieId);
    if (!userMovie) {
      return;
    }

    const clampedRating = Math.max(0, Math.min(10, rating));
    userMovie.rating = clampedRating;
    this.saveUserMovies();
  }

  public getUserMovie(movieId: string): UserMovie | undefined {
    return this.userMovies.get(movieId);
  }

  public getMoviesByStatus(status: WatchStatus): Movie[] {
    const movieIds = Array.from(this.userMovies.values())
      .filter((um) => um.status === status)
      .map((um) => um.movieId);

    return this.movies.filter((movie) => movieIds.includes(movie.id));
  }

  public getAllUserMovies(): { movie: Movie; userMovie: UserMovie }[] {
    return Array.from(this.userMovies.values())
      .map((userMovie) => {
        const movie = this.getMovieById(userMovie.movieId);
        return movie ? { movie, userMovie } : null;
      })
      .filter((item): item is { movie: Movie; userMovie: UserMovie } => item !== null);
  }

  public isFavorite(movieId: string): boolean {
    return this.userMovies.has(movieId);
  }
}

export const movieManager = MovieManager.getInstance();
export default MovieManager;
