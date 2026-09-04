import { mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export const makeDir = async (suffix: string): Promise<string> => {
  const dir = path.join(tmpdir(), `ilha-pages-test-${suffix}-${Date.now()}`);
  await mkdir(dir, { recursive: true });
  return dir;
};

export const writePage = async (
  dir: string,
  rel: string,
  content: string
): Promise<void> => {
  const full = path.join(dir, rel);
  await mkdir(path.join(full, ".."), { recursive: true });
  await writeFile(full, content, "utf-8");
};

export const removeDir = async (dir: string): Promise<string> => {
  await rm(dir, { force: true, recursive: true });
  return dir;
};

export const make = (content: string) => () => content;
