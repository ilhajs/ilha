import { mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function makeDir(suffix: string): Promise<string> {
  const dir = join(tmpdir(), `ilha-pages-test-${suffix}-${Date.now()}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

export async function writePage(dir: string, rel: string, content: string): Promise<void> {
  const full = join(dir, rel);
  await mkdir(join(full, ".."), { recursive: true });
  await writeFile(full, content, "utf8");
}

export async function removeDir(dir: string): Promise<string> {
  await rm(dir, { recursive: true, force: true });
  return dir;
}

export const make = (content: string) => async () => content;
