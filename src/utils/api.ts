import axios from 'axios';
import type { SearchResult, Movie } from '../types';

const API_KEY = '4a3b711b';
const BASE_URL = 'https://www.omdbapi.com/';

const api = axios.create({
  baseURL: BASE_URL,
  timeout: 2000,
});

export async function searchMovies(query: string): Promise<SearchResult[]> {
  try {
    const { data } = await api.get('/', {
      params: { s: query, apikey: API_KEY, type: 'movie' },
    });
    if (data.Response === 'True' && data.Search) {
      return data.Search.map((item: { imdbID: string; Title: string; Year: string; Poster: string; Type: string }) => ({
        id: item.imdbID,
        title: item.Title,
        year: item.Year,
        poster: item.Poster,
        type: item.Type,
      }));
    }
    return [];
  } catch {
    return [];
  }
}

export async function fetchMovieDetail(id: string): Promise<Movie | null> {
  try {
    const { data } = await api.get('/', {
      params: { i: id, apikey: API_KEY, plot: 'full' },
    });
    if (data.Response === 'True') {
      return {
        id: data.imdbID,
        title: data.Title,
        year: parseInt(data.Year) || 0,
        director: data.Director === 'N/A' ? '' : data.Director,
        plot: data.Plot === 'N/A' ? '' : data.Plot,
        poster: data.Poster === 'N/A' ? '' : data.Poster,
        genre: data.Genre === 'N/A' ? '' : data.Genre,
        personalRating: null,
        watchDate: null,
        watched: false,
        addedAt: new Date().toISOString(),
      };
    }
    return null;
  } catch {
    return null;
  }
}
