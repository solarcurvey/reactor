import { ReactorMark } from "./logo";

/** CORE heat-load — same family as the REACTOR vessel, not a second logo. */
export function ReactorCore({ label = "CORE fuel" }: { label?: string }) {
  return (
    <div data-visual-mask className="relative mx-auto grid h-44 w-44 place-items-center">
      <div className="absolute inset-0 rounded-sm bg-rx-heat/10" />
      <div className="absolute inset-4 rounded-sm border border-rx-steel" />
      <div className="absolute inset-8 rounded-sm border border-rx-heat/35 motion-safe:animate-pulse" />
      <ReactorMark className="relative h-24 w-24" title="CORE" />
      <span className="sr-only">{label}</span>
    </div>
  );
}
