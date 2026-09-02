import type { Tone } from '../lib/labels';

export function StatusPill({ label, tone }: { label: string; tone: Tone }) {
  return (
    <span className="pill" data-tone={tone}>
      {label}
    </span>
  );
}
