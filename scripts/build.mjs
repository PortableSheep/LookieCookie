import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHARED_DIR = path.join(ROOT, "shared");
const CHROME_DIR = path.join(ROOT, "chrome");
const FIREFOX_DIR = path.join(ROOT, "firefox");
const ROOT_ICONS_DIR = path.join(ROOT, "icons");
const DIST_DIR = path.join(ROOT, "dist");

const SHARED_FILES = [
  "devtools.html",
  "devtools.js",
  "panel.html",
  "panel.css",
  "panel.js",
];

const SHARED_DIRS = ["icons"];

const readJson = async (filePath) => {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
};

const writeJson = async (filePath, data) => {
  const payload = JSON.stringify(data, null, 2);
  await fs.writeFile(filePath, `${payload}\n`, "utf8");
};

const ensureDir = async (dir) => {
  await fs.mkdir(dir, { recursive: true });
};

const copyFile = async (src, dest) => {
  await ensureDir(path.dirname(dest));
  await fs.copyFile(src, dest);
};

const copyDir = async (src, dest) => {
  const entries = await fs.readdir(src, { withFileTypes: true });
  await ensureDir(dest);
  await Promise.all(
    entries.map(async (entry) => {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        await copyDir(srcPath, destPath);
      } else {
        await copyFile(srcPath, destPath);
      }
    }),
  );
};

const mergeDeep = (base, override) => {
  if (Array.isArray(base) && Array.isArray(override)) {
    return Array.from(new Set([...base, ...override]));
  }
  if (
    base &&
    typeof base === "object" &&
    override &&
    typeof override === "object"
  ) {
    const result = { ...base };
    for (const [key, value] of Object.entries(override)) {
      if (key in result) {
        result[key] = mergeDeep(result[key], value);
      } else {
        result[key] = value;
      }
    }
    return result;
  }
  return override ?? base;
};

const buildManifest = async (browserDir, outDir) => {
  const base = await readJson(path.join(SHARED_DIR, "manifest.base.json"));
  const override = await readJson(path.join(browserDir, "manifest.json"));
  const merged = mergeDeep(base, override);
  await writeJson(path.join(outDir, "manifest.json"), merged);
};

const copyShared = async (outDir) => {
  await Promise.all(
    SHARED_FILES.map((fileName) =>
      copyFile(path.join(SHARED_DIR, fileName), path.join(outDir, fileName)),
    ),
  );
  await Promise.all(
    SHARED_DIRS.map((dirName) =>
      copyDir(path.join(SHARED_DIR, dirName), path.join(outDir, dirName)),
    ),
  );
};

const copyBrowserSpecificFiles = async (browserDir, outDir) => {
  // Copy browser-specific JS files (like browser.js), except background.js which needs special handling
  const entries = await fs.readdir(browserDir);
  const jsFiles = entries.filter((f) => f.endsWith(".js") && f !== "background.js");
  await Promise.all(
    jsFiles.map((fileName) =>
      copyFile(path.join(browserDir, fileName), path.join(outDir, fileName)),
    ),
  );
  
  // Copy browser-specific icon overrides if they exist
  const iconDir = path.join(browserDir, "icons");
  try {
    const stat = await fs.stat(iconDir);
    if (stat.isDirectory()) {
      await copyDir(iconDir, path.join(outDir, "icons"));
    }
  } catch {
    // no browser-specific icon overrides
  }
};

const buildBackgroundScript = async (browserDir, outDir) => {
  // Concatenate shared background logic with browser-specific listener
  const sharedContent = await fs.readFile(path.join(SHARED_DIR, "background.shared.js"), "utf8");
  const browserSpecificPath = path.join(browserDir, "background.js");
  
  let browserSpecificContent = "";
  try {
    const raw = await fs.readFile(browserSpecificPath, "utf8");
    // Remove importScripts line if present - we're concatenating instead
    browserSpecificContent = raw
      .split("\n")
      .filter((line) => !line.includes("importScripts"))
      .join("\n");
  } catch {
    // No browser-specific background.js - that's fine
  }
  
  const combined = `${sharedContent}\n\n// Browser-specific listener\n${browserSpecificContent}`;
  await fs.writeFile(path.join(outDir, "background.js"), combined, "utf8");
};

const copyRootIcons = async (outDir) => {
  // Copy PNG icons from root icons folder for Chrome
  const entries = await fs.readdir(ROOT_ICONS_DIR);
  const pngFiles = entries.filter((f) => f.endsWith(".png"));
  await Promise.all(
    pngFiles.map((fileName) =>
      copyFile(
        path.join(ROOT_ICONS_DIR, fileName),
        path.join(outDir, "icons", fileName),
      ),
    ),
  );
};

const buildBrowser = async (browserName, browserDir) => {
  const outDir = path.join(DIST_DIR, browserName);
  await ensureDir(outDir);
  await copyShared(outDir);
  await copyBrowserSpecificFiles(browserDir, outDir);
  await buildBackgroundScript(browserDir, outDir);
  // Copy PNG icons from root for Chrome
  if (browserName === "chrome") {
    await copyRootIcons(outDir);
  }
  await buildManifest(browserDir, outDir);
};

const main = async () => {
  await fs.rm(DIST_DIR, { recursive: true, force: true });
  await ensureDir(DIST_DIR);

  await Promise.all([
    buildBrowser("chrome", CHROME_DIR),
    buildBrowser("firefox", FIREFOX_DIR),
  ]);

  console.log("Built dist/chrome and dist/firefox from shared sources.");
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
