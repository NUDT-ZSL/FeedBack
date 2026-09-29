import { useState, useEffect, useCallback } from "react";

export interface ColorScheme {
  id: string;
  name: string;
  createdAt: number;
  colors: string[];
}

const STORAGE_KEY = "css_palette_schemes";
const COLORS_KEY = "css_palette_current";

const DEFAULT_COLORS = [
  "#FF6B6B",
  "#4ECDC4",
  "#FFE66D",
  "#95E1D3",
  "#F38181",
  "#AA96DA",
];

function loadSchemes(): ColorScheme[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore
  }
  return [];
}

function saveSchemes(schemes: ColorScheme[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(schemes));
}

function loadCurrentColors(): string[] {
  try {
    const raw = localStorage.getItem(COLORS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore
  }
  return DEFAULT_COLORS;
}

function saveCurrentColors(colors: string[]): void {
  localStorage.setItem(COLORS_KEY, JSON.stringify(colors));
}

export function useColorManager() {
  const [colors, setColors] = useState<string[]>(loadCurrentColors);
  const [schemes, setSchemes] = useState<ColorScheme[]>(loadSchemes);
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const [transitioning, setTransitioning] = useState(false);

  useEffect(() => {
    saveCurrentColors(colors);
  }, [colors]);

  useEffect(() => {
    saveSchemes(schemes);
  }, [schemes]);

  const addColor = useCallback((color: string) => {
    setColors((prev) => [...prev, color]);
  }, []);

  const updateColor = useCallback((index: number, color: string) => {
    setColors((prev) => {
      if (index < 0 || index >= prev.length) return prev;
      const next = [...prev];
      next[index] = color;
      return next;
    });
  }, []);

  const removeColor = useCallback((index: number) => {
    setColors((prev) => {
      if (prev.length <= 1) return prev;
      const next = prev.filter((_, i) => i !== index);
      setSelectedIndex((s) => Math.max(0, Math.min(s, next.length - 1)));
      return next;
    });
  }, []);

  const reorderColors = useCallback((fromIndex: number, toIndex: number) => {
    setColors((prev) => {
      const next = [...prev];
      const [removed] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, removed);
      return next;
    });
    setSelectedIndex(toIndex);
  }, []);

  const saveScheme = useCallback((name: string) => {
    const scheme: ColorScheme = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name: name.trim() || `方案 ${schemes.length + 1}`,
      createdAt: Date.now(),
      colors: [...colors],
    };
    setSchemes((prev) => [scheme, ...prev].sort((a, b) => b.createdAt - a.createdAt));
    return scheme;
  }, [colors, schemes.length]);

  const loadScheme = useCallback((scheme: ColorScheme) => {
    setTransitioning(true);
    setColors([...scheme.colors]);
    setSelectedIndex(0);
    setTimeout(() => setTransitioning(false), 400);
  }, []);

  const deleteScheme = useCallback((id: string) => {
    setSchemes((prev) => prev.filter((s) => s.id !== id));
  }, []);

  const sortedSchemes = [...schemes].sort((a, b) => b.createdAt - a.createdAt);

  return {
    colors,
    selectedIndex,
    setSelectedIndex,
    addColor,
    updateColor,
    removeColor,
    reorderColors,
    saveScheme,
    loadScheme,
    deleteScheme,
    schemes: sortedSchemes,
    transitioning,
  };
}
