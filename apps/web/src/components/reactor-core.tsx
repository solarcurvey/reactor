import { ReactorMark } from "./logo";

export function ReactorCore({ label = "CORE fuel" }: { label?: string }) {
  return (
    <div data-visual-mask className="relative mx-auto grid h-44 w-44 place-items-center">
      <div className="absolute inset-0 rounded-full bg-cyan-400/10 blur-2xl" />
      <div className="absolute inset-4 rounded-full border border-cyan-200/15" />
      <div className="absolute inset-8 rounded-full border border-cyan-200/25 animate-pulse" />
      <ReactorMark className="relative h-24 w-24" spin />
      <span className="sr-only">{label}</span>
    </div>
  );
}
