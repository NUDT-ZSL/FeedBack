import { toPng } from 'html-to-image';

export async function exportCardAsPNG(
  element: HTMLElement,
  fileName: string = 'birthday-card.png'
): Promise<string> {
  try {
    const dataUrl = await toPng(element, {
      quality: 1,
      pixelRatio: 2,
      width: 1920,
      height: 1080,
      cacheBust: true,
    });

    const link = document.createElement('a');
    link.download = fileName;
    link.href = dataUrl;
    link.click();

    return dataUrl;
  } catch (error) {
    console.error('Export failed:', error);
    throw error;
  }
}

export async function generateThumbnail(
  element: HTMLElement
): Promise<string> {
  try {
    const dataUrl = await toPng(element, {
      quality: 0.8,
      pixelRatio: 1,
      width: 320,
      height: 180,
      cacheBust: true,
    });
    return dataUrl;
  } catch (error) {
    console.error('Thumbnail generation failed:', error);
    throw error;
  }
}
