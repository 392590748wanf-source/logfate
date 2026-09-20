import { cp, mkdir, readdir, rm, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const output = join(root, "dist-web");
const excludedDirectories = new Set([
  ".git",
  ".pnpm-store",
  ".tmp-docx-read",
  "build",
  "dist",
  "dist-web",
  "electron",
  "node_modules",
  "release",
  "release-1.1.9",
  "tools",
]);
const includedDirectories = new Set(["assets", "data"]);
const includedRootFiles = /^(?:[^.].*\.(?:css|html|js|json)|_headers|_redirects)$/i;

async function copyFile(source, target) {
  await mkdir(dirname(target), { recursive: true });
  await cp(source, target);
}

async function main() {
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });

  for (const entry of await readdir(root, { withFileTypes: true })) {
    const source = join(root, entry.name);
    const target = join(output, entry.name);

    if (entry.isDirectory()) {
      if (includedDirectories.has(entry.name)) {
        await cp(source, target, { recursive: true });
      } else if (!excludedDirectories.has(entry.name)) {
        console.warn(`Skipped unlisted directory: ${entry.name}`);
      }
      continue;
    }

    if (entry.isFile() && includedRootFiles.test(entry.name)) {
      await copyFile(source, target);
    }
  }

  const largeFiles = [];
  async function checkFiles(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await checkFiles(path);
      else if (entry.isFile() && (await stat(path)).size > 25 * 1024 * 1024) {
        largeFiles.push(path.slice(output.length + 1));
      }
    }
  }
  await checkFiles(output);

  if (largeFiles.length) {
    throw new Error(`Cloudflare Pages files must be at most 25 MiB: ${largeFiles.join(", ")}`);
  }

  console.log(`Built web deployment files in ${basename(output)}.`);
}

await main();
