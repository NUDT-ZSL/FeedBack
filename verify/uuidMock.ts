let counter = 0;

export function __resetUuid(): void {
  counter = 0;
}

export function v4(): string {
  counter += 1;
  return `uuid-${counter.toString().padStart(4, '0')}`;
}

export default { v4 };
