import { useRef, useEffect, useCallback } from 'react';

export function useAudio() {
  const audioContextRef = useRef<AudioContext | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);

  const initAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      masterGainRef.current = audioContextRef.current.createGain();
      masterGainRef.current.gain.value = 0.3;
      masterGainRef.current.connect(audioContextRef.current.destination);
    }
    if (audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume();
    }
    return { audioContext: audioContextRef.current, masterGain: masterGainRef.current! };
  }, []);

  const playDropSound = useCallback(() => {
    const { audioContext, masterGain } = initAudioContext();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(800, audioContext.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(200, audioContext.currentTime + 0.15);

    gainNode.gain.setValueAtTime(0.5, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.15);

    oscillator.connect(gainNode);
    gainNode.connect(masterGain);

    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.15);
  }, [initAudioContext]);

  const playBambooSound = useCallback(() => {
    const { audioContext, masterGain } = initAudioContext();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    const lfo = audioContext.createOscillator();
    const lfoGain = audioContext.createGain();

    oscillator.type = 'triangle';
    oscillator.frequency.setValueAtTime(400, audioContext.currentTime);

    lfo.type = 'sine';
    lfo.frequency.setValueAtTime(30, audioContext.currentTime);
    lfoGain.gain.setValueAtTime(50, audioContext.currentTime);

    lfo.connect(lfoGain);
    lfoGain.connect(oscillator.frequency);

    gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.2);

    oscillator.connect(gainNode);
    gainNode.connect(masterGain);

    oscillator.start(audioContext.currentTime);
    lfo.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.2);
    lfo.stop(audioContext.currentTime + 0.2);
  }, [initAudioContext]);

  const playHitSound = useCallback(() => {
    const { audioContext, masterGain } = initAudioContext();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator.type = 'square';
    oscillator.frequency.setValueAtTime(150, audioContext.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(50, audioContext.currentTime + 0.1);

    gainNode.gain.setValueAtTime(0.4, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.1);

    oscillator.connect(gainNode);
    gainNode.connect(masterGain);

    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.1);
  }, [initAudioContext]);

  const playSteamSound = useCallback(() => {
    const { audioContext, masterGain } = initAudioContext();
    const bufferSize = audioContext.sampleRate * 0.3;
    const buffer = audioContext.createBuffer(1, bufferSize, audioContext.sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const noise = audioContext.createBufferSource();
    noise.buffer = buffer;

    const filter = audioContext.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1000, audioContext.currentTime);
    filter.frequency.exponentialRampToValueAtTime(200, audioContext.currentTime + 0.3);

    const gainNode = audioContext.createGain();
    gainNode.gain.setValueAtTime(0.25, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);

    noise.connect(filter);
    filter.connect(gainNode);
    gainNode.connect(masterGain);

    noise.start(audioContext.currentTime);
    noise.stop(audioContext.currentTime + 0.3);
  }, [initAudioContext]);

  const playSuccessSound = useCallback(() => {
    const { audioContext, masterGain } = initAudioContext();
    const notes = [261.63, 329.63, 392.00, 523.25];
    const noteDuration = 0.12;

    notes.forEach((freq, index) => {
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      const startTime = audioContext.currentTime + index * noteDuration;

      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(freq, startTime);

      gainNode.gain.setValueAtTime(0.35, startTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, startTime + noteDuration * 0.9);

      oscillator.connect(gainNode);
      gainNode.connect(masterGain);

      oscillator.start(startTime);
      oscillator.stop(startTime + noteDuration);
    });
  }, [initAudioContext]);

  useEffect(() => {
    return () => {
      if (audioContextRef.current) {
        audioContextRef.current.close();
        audioContextRef.current = null;
        masterGainRef.current = null;
      }
    };
  }, []);

  return {
    playDropSound,
    playBambooSound,
    playHitSound,
    playSteamSound,
    playSuccessSound,
  };
}
