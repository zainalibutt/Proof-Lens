import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],

  build: {
    // Vite default output dir is "dist" — matches vercel.json
    outDir: "dist",
    sourcemap: false,

    rollupOptions: {
      output: {
        // Manual chunk splitting for better caching
        manualChunks(id) {
          // Rolldown expects a classifier function here.
          if (!id.includes("node_modules")) return undefined;
          if (/node_modules\/(react|react-dom|react-router|react-router-dom)\//.test(id)) {
            return "vendor-react";
          }
          if (id.includes("node_modules/@supabase/")) return "vendor-supabase";
          if (id.includes("node_modules/lucide-react/")) return "vendor-icons";
          return undefined;
        },
      },
    },

    // Increase chunk size warning limit (the manual chunks above may exceed default)
    chunkSizeWarningLimit: 600,

    // Enable CSS code-splitting (default in Vite 5, explicit for clarity)
    cssCodeSplit: true,

    // Minification
    minify: "oxc",

    // Target modern browsers for smaller output
    target: "es2020",
  },

  // Optimise dependency pre-bundling in dev
  optimizeDeps: {
    include: ["react", "react-dom", "@supabase/supabase-js", "lucide-react"],
  },
});
