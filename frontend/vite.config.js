import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [react()],
    build: {
      rollupOptions: {
        // Stable vendor chunks: they stay cached across deployments while only the (lazy) page chunks change.
        output: { manualChunks: { react: ["react", "react-dom"], router: ["react-router-dom"], http: ["axios"] } },
      },
    },
    server: {
      port: Number(env.VITE_DEV_PORT || 5173),
      proxy: {
        "/api": {
          target: env.VITE_DEV_API_PROXY || "http://localhost:5050",
          changeOrigin: true,
        },
      },
    },
  };
});
