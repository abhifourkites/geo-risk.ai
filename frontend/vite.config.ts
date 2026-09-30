import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The dev server forwards /api to the backend container.
// maplibre-gl is not pre-bundled: it finds its web worker next to its own file
// (new URL("./maplibre-gl-worker.mjs", import.meta.url)), which pre-bundling would move away from.
export default defineConfig({
  plugins: [react()],
  server: { proxy: { "/api": "http://backend:8000" } },
  optimizeDeps: { exclude: ["maplibre-gl"] },
});
