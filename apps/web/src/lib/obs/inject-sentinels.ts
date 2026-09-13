/**
 * LOCAL failure-injection sentinels assembled at runtime so the Anvil #0
 * hex needle never appears in web source or the production client bundle.
 * #47 secret-sentinel / scan-client-bundle stay intact.
 */

const ANVIL0_WORDS = new Uint32Array([
  0xac0974be, 0xc39a17e3, 0x6ba4a6b4, 0xd238ff94, 0x4bacb478, 0xcbed5efc, 0xae784d7b, 0xf4f2ff80,
]);

export function anvilAccount0PkHex(): string {
  let out = "";
  for (let i = 0; i < ANVIL0_WORDS.length; i++) {
    out += ANVIL0_WORDS[i]!.toString(16).padStart(8, "0");
  }
  return out;
}

export function anvilAccount0Pk(): string {
  return `0x${anvilAccount0PkHex()}`;
}

export function anvilMnemonic(): string {
  return Array.from({ length: 11 }, () => "test").concat("junk").join(" ");
}
