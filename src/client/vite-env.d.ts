/// <reference types="vite/client" />

declare module 'wordcloud' {
  interface WordCloudOptions {
    list: Array<[string, number]>;
    gridSize?: number;
    weightFactor?: number | ((size: number) => number);
    fontFamily?: string;
    color?: string | ((word: string, weight: number) => string) | (() => string);
    rotateRatio?: number;
    backgroundColor?: string;
    drawOutOfBound?: boolean;
    shrinkToFit?: boolean;
    minSize?: number;
    maxSize?: number;
    click?: (item: [string, number], dimension: { x: number; y: number; w: number; h: number }, event: MouseEvent) => void;
    hover?: (item: [string, number], dimension: { x: number; y: number; w: number; h: number }, event: MouseEvent) => void;
  }

  function WordCloud(
    element: HTMLCanvasElement | HTMLElement,
    options: WordCloudOptions
  ): void;

  export default WordCloud;
}
