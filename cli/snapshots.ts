import { randomUUID } from "node:crypto";
// Snapshot each response once, then transfer bounded chunks. Pages cannot mix
// revisions if an agent writes a tour while the client is loading it.
export function snapshotStore() {
  const entries = new Map<string, { data: Buffer; expires: number }>();
  const chunkSize = 256 * 1024;
  const maxBytes = 128 * 1024 * 1024;
  function prune() {
    for (const [key, value] of entries) if (value.expires < Date.now()) entries.delete(key);
  }
  return {
    create(value: unknown) {
      prune();
      const data = Buffer.from(JSON.stringify(value));
      const used = [...entries.values()].reduce((sum, value) => sum + value.data.length, 0);
      if (used + data.length > maxBytes)
        throw new Error("Tour loading capacity reached. Finish another download and retry.");
      const token = randomUUID();
      entries.set(token, { data, expires: Date.now() + 5 * 60_000 });
      return { token, chunks: Math.max(1, Math.ceil(data.length / chunkSize)) };
    },
    chunk(token: string, index: number) {
      prune();
      const entry = entries.get(token);
      if (!entry) throw new Error("Tour snapshot expired. Retry loading the tour.");
      if (index < 0 || index >= Math.ceil(entry.data.length / chunkSize))
        throw new Error("Invalid snapshot chunk");
      entry.expires = Date.now() + 5 * 60_000;
      return entry.data.subarray(index * chunkSize, (index + 1) * chunkSize).toString("base64");
    },
    release(token: string) {
      entries.delete(token);
    },
    clear() {
      entries.clear();
    },
  };
}
