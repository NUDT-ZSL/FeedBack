import pako from 'pako';
import type { Piece, FormationType } from './types';

export interface ExportData {
  version: string;
  timestamp: number;
  pieces: Piece[];
  playerFormation: FormationType | null;
  aiFormation: FormationType | null;
}

export function compressState(
  pieces: Piece[],
  playerFormation: FormationType | null,
  aiFormation: FormationType | null
): string {
  const data: ExportData = {
    version: '1.0',
    timestamp: Date.now(),
    pieces,
    playerFormation,
    aiFormation,
  };

  const jsonStr = JSON.stringify(data);
  const compressed = pako.deflate(jsonStr);
  const base64 = btoa(String.fromCharCode(...compressed));
  return base64;
}

export function decompressState(compressed: string): ExportData | null {
  try {
    const compressedData = Uint8Array.from(atob(compressed), (c) =>
      c.charCodeAt(0)
    );
    const decompressed = pako.inflate(compressedData, { to: 'string' });
    const data = JSON.parse(decompressed) as ExportData;
    return data;
  } catch (e) {
    console.error('Failed to decompress state:', e);
    return null;
  }
}

export function downloadJSON(
  pieces: Piece[],
  playerFormation: FormationType | null,
  aiFormation: FormationType | null,
  filename: string = '阵图.json'
): void {
  const data: ExportData = {
    version: '1.0',
    timestamp: Date.now(),
    pieces,
    playerFormation,
    aiFormation,
  };

  const jsonStr = JSON.stringify(data, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export async function copyShareLink(
  pieces: Piece[],
  playerFormation: FormationType | null,
  aiFormation: FormationType | null
): Promise<boolean> {
  try {
    const compressed = compressState(pieces, playerFormation, aiFormation);
    const baseUrl = window.location.origin + window.location.pathname;
    const shareUrl = `${baseUrl}?data=${encodeURIComponent(compressed)}`;

    await navigator.clipboard.writeText(shareUrl);
    return true;
  } catch (e) {
    console.error('Failed to copy share link:', e);
    return false;
  }
}

export function loadFromUrl(): ExportData | null {
  const params = new URLSearchParams(window.location.search);
  const data = params.get('data');
  if (data) {
    return decompressState(decodeURIComponent(data));
  }
  return null;
}
