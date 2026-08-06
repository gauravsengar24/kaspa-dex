import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  assetsInclude: ["**/*.wasm"],
  optimizeDeps: {
    exclude: ["@kronsdk/kron-sdk/wasm"],
  },
  build: {
    outDir: "dist",
  },
})
