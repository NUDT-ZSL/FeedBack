import { readFile } from 'node:fs/promises';

export class FakeBlob {
  constructor(parts = []) { this.parts = parts; }
}

export class FakeFile {
  constructor(buffer, name) {
    const bytes = new Uint8Array(buffer);
    this.name = name;
    this.size = bytes.byteLength;
    this.bytes = bytes;
  }

  slice(start, end) {
    const copy = this.bytes.slice(start, end).buffer;
    return {
      async arrayBuffer() { return copy; }
    };
  }
}

export class FakeUrl {
  static createObjectURL() { return 'blob:fake-worker'; }
  static revokeObjectURL() {}
}

export class FakeWorker {
  constructor() {
    this.onmessage = null;
    this.onerror = null;
  }

  postMessage(message) {
    const source = new Uint8Array(message.data);
    const output = new Uint8Array(source.length);
    for (let i = 0; i < source.length; i++) output[i] = source[i] ^ 0x5a;
    queueMicrotask(async () => {
      const digest = await crypto.subtle.digest('SHA-256', output.buffer);
      const hash = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
      this.onmessage({ data: {
        type: 'converted', jobId: message.jobId, index: message.index,
        data: output.buffer, hash, transformedBytes: output.byteLength
      }});
    });
  }

  terminate() {}
}

export function installBrowserStubs() {
  globalThis.Blob = FakeBlob;
  globalThis.URL = FakeUrl;
  globalThis.Worker = FakeWorker;
  globalThis.requestAnimationFrame = (callback) => Promise.resolve().then(callback);

  const elements = {
    jobs: { innerHTML: '' },
    notice: { innerHTML: '' },
    'add-form': { addEventListener() {} },
    'file-input': { files: [] },
    'chunk-size': { value: '2' }
  };
  globalThis.document = {
    addEventListener() {},
    querySelector(selector) { return elements[selector.slice(1)]; },
    createElement() { return { style: {}, files: null, click() {}, remove() {} }; },
    body: { appendChild() {}, innerHTML: '' }
  };
  return elements;
}

export async function makeFile(path, name) {
  return new FakeFile(await readFile(path), name);
}
