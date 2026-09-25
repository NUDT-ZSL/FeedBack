export function tagToColor(tag: string): string {
  let hash = 0;
  for (let i = 0; i < tag.length; i++) {
    hash = tag.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 50%, 55%)`;
}

export function stringToColor(str: string): string {
  if (!str) return 'var(--accent)';
  return tagToColor(str);
}
