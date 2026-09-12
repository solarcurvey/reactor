import sharp from "sharp";

/** Fail closed if sharp native bindings are missing. Not optional. */
export async function assertSharpWorks(): Promise<void> {
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  try {
    const out = await sharp(png).rotate().resize(8, 8).webp({ quality: 80 }).toBuffer();
    if (!out || out.length < 16) throw new Error("sharp produced empty output");
  } catch (e) {
    throw new Error(
      `sharp is a required production dependency and failed to process an image: ${e instanceof Error ? e.message : e}. On a fresh host run \`pnpm approve-builds\` (allow sharp) then \`pnpm install\`.`,
    );
  }
}
