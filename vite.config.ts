import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [
    tsconfigPaths(),
    tailwindcss(),
    tanstackStart({ spa: { enabled: true } }),
    react(),
  ],
  server: { host: "127.0.0.1", port: 5173 },
  build: { chunkSizeWarningLimit: 1200 },
});
