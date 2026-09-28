import { useThree } from '@react-three/fiber';
import { saveAs } from 'file-saver';
import { useEffect, useCallback } from 'react';

const Screenshot: React.FC = () => {
  const { gl } = useThree();

  const takeScreenshot = useCallback((): void => {
    const dataURL = gl.domElement.toDataURL('image/png');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `fabric_preview_${timestamp}.png`;
    saveAs(dataURL, filename);
  }, [gl]);

  useEffect(() => {
    (window as unknown as { __takeScreenshot: () => void }).__takeScreenshot = takeScreenshot;
    return () => {
      delete (window as unknown as { __takeScreenshot?: () => void }).__takeScreenshot;
    };
  }, [takeScreenshot]);

  return null;
};

export { Screenshot };
