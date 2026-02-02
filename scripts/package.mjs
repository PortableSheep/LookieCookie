import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST_DIR = path.join(ROOT, "dist");

const packageExtension = async (browserName) => {
  const sourceDir = path.join(DIST_DIR, browserName);
  const outputZip = path.join(DIST_DIR, `${browserName}.zip`);

  // Remove existing zip if present
  try {
    await fs.unlink(outputZip);
  } catch {
    // File doesn't exist, which is fine
  }

  // Verify source directory exists
  try {
    await fs.access(sourceDir);
  } catch {
    throw new Error(`Source directory not found: ${sourceDir}. Run "npm run build" first.`);
  }

  // Create zip using system zip command (available on macOS/Linux)
  // -r: recursive, -j: junk paths (not needed), working from dist dir
  execSync(`cd "${sourceDir}" && zip -r "../${browserName}.zip" .`, {
    stdio: "inherit",
  });

  console.log(`Packaged: ${outputZip}`);
};

const main = async () => {
  await packageExtension("chrome");
  await packageExtension("firefox");
  console.log("\nPackaging complete! Upload these files to the respective stores:");
  console.log(`  Chrome: ${path.join(DIST_DIR, "chrome.zip")}`);
  console.log(`  Firefox: ${path.join(DIST_DIR, "firefox.zip")}`);
};

main().catch((error) => {
  console.error("Packaging failed:", error.message);
  process.exitCode = 1;
});
