import { useRef, useEffect, useCallback } from 'react';

const useAudio = () => {
  const audioContextRef = useRef<AudioContext | null>(null);
  const activeNodesRef = useRef<AudioNode[]>([]);

  const ensureAudioContext = useCallback(async () => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    }
    if (audioContextRef.current.state === 'suspended') {
      await audioContextRef.current.resume();
    }
    return audioContextRef.current;
  }, []);

  const addActiveNode = useCallback((node: AudioNode) => {
    activeNodesRef.current.push(node);
  }, []);

  const stopAll = useCallback(() => {
    activeNodesRef.current.forEach((node) => {
      try {
        if ('stop' in node) {
          (node as AudioScheduledSourceNode).stop();
        }
        node.disconnect();
      } catch {
        // ignore errors when stopping nodes
      }
    });
    activeNodesRef.current = [];
  }, []);

  const playBoneFriction = useCallback(async () => {
    const ctx = await ensureAudioContext();

    const bufferSize = ctx.sampleRate * 0.1;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * 0.3;
    }

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 200;
    filter.Q.value = 1;

    const lfo = ctx.createOscillator();
    lfo.frequency.value = 15;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 100;
    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);

    const gain = ctx.createGain();
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.4, now + 0.01);
    gain.gain.linearRampToValueAtTime(0, now + 0.1);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    addActiveNode(noise);
    addActiveNode(lfo);

    noise.start(now);
    lfo.start(now);
    noise.stop(now + 0.1);
    lfo.stop(now + 0.1);
  }, [ensureAudioContext, addActiveNode]);

  const playResetSuccess = useCallback(async () => {
    const ctx = await ensureAudioContext();

    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = 800;

    const gain = ctx.createGain();
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0.3, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

    osc.connect(gain);
    gain.connect(ctx.destination);

    addActiveNode(osc);

    osc.start(now);
    osc.stop(now + 0.15);
  }, [ensureAudioContext, addActiveNode]);

  const playPlaceMaterial = useCallback(async () => {
    const ctx = await ensureAudioContext();

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 400;

    const gain = ctx.createGain();
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.25, now + 0.05);
    gain.gain.linearRampToValueAtTime(0, now + 0.3);

    osc.connect(gain);
    gain.connect(ctx.destination);

    addActiveNode(osc);

    osc.start(now);
    osc.stop(now + 0.3);
  }, [ensureAudioContext, addActiveNode]);

  const playRehabComplete = useCallback(async () => {
    const ctx = await ensureAudioContext();

    const notes = [523.25, 659.25, 783.99];
    const now = ctx.currentTime;

    notes.forEach((freq, index) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;

      const gain = ctx.createGain();
      const startTime = now + index * 0.15;
      gain.gain.setValueAtTime(0, startTime);
      gain.gain.linearRampToValueAtTime(0.3, startTime + 0.02);
      gain.gain.linearRampToValueAtTime(0, startTime + 0.2);

      osc.connect(gain);
      gain.connect(ctx.destination);

      addActiveNode(osc);

      osc.start(startTime);
      osc.stop(startTime + 0.2);
    });
  }, [ensureAudioContext, addActiveNode]);

  useEffect(() => {
    const handleFirstInteraction = async () => {
      if (audioContextRef.current?.state === 'suspended') {
        await audioContextRef.current.resume();
      }
      document.removeEventListener('click', handleFirstInteraction);
      document.removeEventListener('touchstart', handleFirstInteraction);
      document.removeEventListener('keydown', handleFirstInteraction);
    };

    document.addEventListener('click', handleFirstInteraction);
    document.addEventListener('touchstart', handleFirstInteraction);
    document.addEventListener('keydown', handleFirstInteraction);

    return () => {
      document.removeEventListener('click', handleFirstInteraction);
      document.removeEventListener('touchstart', handleFirstInteraction);
      document.removeEventListener('keydown', handleFirstInteraction);

      stopAll();

      if (audioContextRef.current) {
        audioContextRef.current.close();
        audioContextRef.current = null;
      }
    };
  }, [stopAll]);

  return {
    playBoneFriction,
    playResetSuccess,
    playPlaceMaterial,
    playRehabComplete,
    stopAll,
  };
};

export default useAudio;
