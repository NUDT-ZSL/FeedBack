// Audio stand-in: Howl instances keep call counts observable instead of playing sound.
export class Howl {
  static instances = [];
  constructor(options = {}) {
    this.options = options;
    this.playCount = 0;
    this.playingCalls = 0;
    Howl.instances.push(this);
  }
  play() {
    this.playCount += 1;
    return 1;
  }
  stop() {}
  unload() {}
}

export const Howler = {
  ctx: null,
  mute: false,
  volume: 1,
};
