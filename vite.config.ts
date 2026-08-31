import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

import { SERVER_PORT, WEB_PORT } from "./server/config";

export default defineConfig({
  plugins: [react()],
  root: "web",
  server: {
    port: WEB_PORT,
    proxy: { "/api": `http://localhost:${SERVER_PORT}` },
  },
});
