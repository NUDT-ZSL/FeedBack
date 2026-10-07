interface ActionToastProps {
  message: string;
  toastKey: number;
}

export default function ActionToast({ message, toastKey }: ActionToastProps) {
  if (!message) return null;
  return (
    <div
      key={toastKey}
      className="pointer-events-none fixed left-1/2 top-20 z-40 -translate-x-1/2 rounded-lg bg-black/60 px-4 py-2 text-sm text-white"
      style={{ animation: 'toastFade 1.5s ease-in-out forwards' }}
    >
      {message}
    </div>
  );
}
