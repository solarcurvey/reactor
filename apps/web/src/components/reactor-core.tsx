import { ReactorMark } from "./logo";

export function ReactorCore({ label = "CORE fuel" }: { label?: string }) {
  return (
    <div data-visual-mask className="relative mx-auto grid h-44 w-44 place-items-center">
      <div className="absolute inset-0 rounded-[4px] bg-rx-heat/12 blur-2xl" />
      <div className="absolute inset-4 rounded-[4px] border border-rx-vessel/40" />
      <div className="absolute inset-8 rounded-[4px] border border-rx-heat/30 animate-pulse" />
      <ReactorMark className="relative h-24 w-24" variant="core" spin />
      <span className="sr-only">{label}</span>
    </div>
  );
}
