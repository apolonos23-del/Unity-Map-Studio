import { copyFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
const shell = resolve("dist/client/_shell.html");
if (!existsSync(shell))
  throw new Error("Missing SPA shell: run the Vite build first.");
copyFileSync(shell, resolve("dist/client/index.html"));
console.log("Vercel SPA entry ready: dist/client/index.html");
