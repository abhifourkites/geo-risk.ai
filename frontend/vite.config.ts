import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The dev server forwards /api to the backend container.
export default defineConfig({
  plugins: [react()],
  server: { proxy: { "/api": "http://backend:8000" } },
});
