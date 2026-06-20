// Runs the (multi-second, long-baseline) Lomb–Scargle off the main thread so the render loop /
// VR frames never stall. See lombScargleAsync in periodogram.ts. (No `lib: webworker` reference —
// that would leak worker globals into the project's DOM typings; we narrow `self` locally instead.)
import { lombScargle } from './periodogram';

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent) => void) | null;
  postMessage: (msg: unknown) => void;
};

ctx.onmessage = (e: MessageEvent) => {
  const { t, y, opts } = e.data as { t: number[]; y: number[]; opts?: Record<string, number> };
  ctx.postMessage(lombScargle(t, y, opts));
};
