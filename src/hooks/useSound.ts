import { useEffect, useRef, useCallback } from 'react';
import { Howl } from 'howler';
import { useAppStore } from '../store';
import type { SoundQueueItem } from '../types';

interface SoundDefinition {
  type: SoundQueueItem['type'];
  frequency: number;
  duration: number;
  typeOscillator: OscillatorType;
}

const SOUND_DEFINITIONS: Record<SoundQueueItem['type'], SoundDefinition> = {
  friction: {
    type: 'friction',
    frequency: 200,
    duration: 0.15,
    typeOscillator: 'sawtooth',
  },
  snap: {
    type: 'snap',
    frequency: 800,
    duration: 0.1,
    typeOscillator: 'sine',
  },
  error: {
    type: 'error',
    frequency: 100,
    duration: 0.3,
    typeOscillator: 'square',
  },
  drag: {
    type: 'drag',
    frequency: 150,
    duration: 0.05,
    typeOscillator: 'triangle',
  },
};

const generateAudioBuffer = (
  audioContext: AudioContext,
  definition: SoundDefinition,
  pitch: number
): AudioBuffer => {
  const sampleRate = audioContext.sampleRate;
  const duration = definition.duration;
  const buffer = audioContext.createBuffer(1, sampleRate * duration, sampleRate);
  const data = buffer.getChannelData(0);

  const frequency = definition.frequency * pitch;
  const samples = buffer.length;

  for (let i = 0; i < samples; i++) {
    const t = i / sampleRate;
    const envelope = Math.exp(-t * 8);

    let sample: number;
    switch (definition.typeOscillator) {
      case 'sine':
        sample = Math.sin(2 * Math.PI * frequency * t);
        break;
      case 'sawtooth':
        sample = 2 * (t * frequency - Math.floor(0.5 + t * frequency));
        break;
      case 'square':
        sample = Math.sign(Math.sin(2 * Math.PI * frequency * t));
        break;
      case 'triangle':
        sample = 2 * Math.abs(2 * (t * frequency - Math.floor(t * frequency + 0.5))) - 1;
        break;
      default:
        sample = Math.sin(2 * Math.PI * frequency * t);
    }

    if (definition.type === 'friction') {
      const noise = (Math.random() * 2 - 1) * 0.3;
      sample = sample * 0.7 + noise;
    }

    data[i] = sample * envelope;
  }

  return buffer;
};

export const useSound = () => {
  const audioContextRef = useRef<AudioContext | null>(null);
  const soundCacheRef = useRef<Map<string, Howl>>(new Map());
  const isInitializedRef = useRef(false);

  const { soundQueue } = useAppStore((state) => ({
    soundQueue: state.soundQueue,
  }));

  const removeFromQueue = useCallback((id: string) => {
    useAppStore.setState((state) => ({
      soundQueue: state.soundQueue.filter((s) => s.id !== id),
    }));
  }, []);

  const initAudio = useCallback(() => {
    if (isInitializedRef.current) return;

    try {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      isInitializedRef.current = true;
    } catch (error) {
      console.warn('AudioContext not supported:', error);
    }
  }, []);

  const createHowl = useCallback(
    (item: SoundQueueItem): Howl | null => {
      if (!audioContextRef.current) return null;

      const cacheKey = `${item.type}-${item.pitch}`;
      if (soundCacheRef.current.has(cacheKey)) {
        return soundCacheRef.current.get(cacheKey)!;
      }

      const definition = SOUND_DEFINITIONS[item.type];
      const buffer = generateAudioBuffer(audioContextRef.current, definition, item.pitch);

      const wavBlob = audioBufferToWav(buffer);
      const url = URL.createObjectURL(wavBlob);

      const howl = new Howl({
        src: [url],
        volume: item.volume,
        onend: () => {
          URL.revokeObjectURL(url);
        },
      });

      soundCacheRef.current.set(cacheKey, howl);
      return howl;
    },
    []
  );

  const playSound = useCallback(
    (item: SoundQueueItem) => {
      if (!audioContextRef.current) {
        initAudio();
      }

      if (!audioContextRef.current) return;

      const howl = createHowl(item);
      if (howl) {
        howl.play();
      }

      removeFromQueue(item.id);
    },
    [createHowl, initAudio, removeFromQueue]
  );

  useEffect(() => {
    if (soundQueue.length > 0) {
      initAudio();
      soundQueue.forEach((item) => {
        playSound(item);
      });
    }
  }, [soundQueue, initAudio, playSound]);

  useEffect(() => {
    const handleFirstInteraction = () => {
      initAudio();
      document.removeEventListener('click', handleFirstInteraction);
      document.removeEventListener('touchstart', handleFirstInteraction);
    };

    document.addEventListener('click', handleFirstInteraction);
    document.addEventListener('touchstart', handleFirstInteraction);

    return () => {
      document.removeEventListener('click', handleFirstInteraction);
      document.removeEventListener('touchstart', handleFirstInteraction);
    };
  }, [initAudio]);

  return {
    initAudio,
  };
};

function audioBufferToWav(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1;
  const bitDepth = 16;

  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;

  const dataLength = buffer.length * blockAlign;
  const bufferLength = 44 + dataLength;

  const arrayBuffer = new ArrayBuffer(bufferLength);
  const view = new DataView(arrayBuffer);

  const writeString = (offset: number, string: string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, bufferLength - 8, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeString(36, 'data');
  view.setUint32(40, dataLength, true);

  const channels: Float32Array[] = [];
  for (let i = 0; i < numChannels; i++) {
    channels.push(buffer.getChannelData(i));
  }

  let offset = 44;
  for (let i = 0; i < buffer.length; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, channels[ch][i]));
      const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      view.setInt16(offset, intSample, true);
      offset += 2;
    }
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' });
}
