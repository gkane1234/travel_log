const remoteHashes = new Map<string, string>();

export function mediaDuplicate(
  plannedName: string,
  hash: string,
  names: Set<string>,
  hashes: Map<string, string>,
): boolean {
  if (plannedName && names.has(plannedName)) return true;
  if (hash && hashes.has(hash)) return true;
  return false;
}

export function skippedNote(name: string): string {
  return `Skipped ${name} because it is already there.`;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const digest = await crypto.subtle.digest("SHA-256", copy);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Hash media already stored for this trip. Missing files are ignored. */
export async function hashesForMedia(slug: string, names: Iterable<string>): Promise<Map<string, string>> {
  const hashes = new Map<string, string>();
  for (const name of names) {
    if (!name || name.includes("/") || name.includes("..")) continue;
    const key = `${slug}/${name}`;
    let hash = remoteHashes.get(key) || "";
    if (!hash) {
      try {
        const response = await fetch(`/travel-log/media/${slug}/photos/${name}`, { credentials: "include" });
        if (!response.ok) continue;
        hash = await sha256Hex(new Uint8Array(await response.arrayBuffer()));
        remoteHashes.set(key, hash);
      } catch {
        continue;
      }
    }
    if (hash) hashes.set(hash, name);
  }
  return hashes;
}

export function rememberMediaHash(slug: string, filename: string, hash: string): void {
  if (!hash) return;
  remoteHashes.set(`${slug}/${filename}`, hash);
}
