export function isAbortError(e: unknown): boolean {
  return (
    (e instanceof Error && (e.name === "AbortError" || e.message === "The operation was aborted.")) ||
    (typeof DOMException !== "undefined" && e instanceof DOMException && e.name === "AbortError")
  );
}

export function throwIfAborted(signal?: AbortSignal | null): void {
  if (!signal?.aborted) return;
  if (typeof DOMException !== "undefined") {
    throw new DOMException("The operation was aborted.", "AbortError");
  }
  const err = new Error("The operation was aborted.");
  err.name = "AbortError";
  throw err;
}
