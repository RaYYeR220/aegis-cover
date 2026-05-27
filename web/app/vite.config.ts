import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "./", // relative — works from any static host / file path
  plugins: [react()],
  test: {
    globals: true,
    environment: "node",
  },
});
