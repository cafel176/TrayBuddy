import { defineConfig } from "vite";
import { sveltekit } from "@sveltejs/kit/vite";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vitejs.dev/config/
export default defineConfig(async () => ({
  plugins: [sveltekit()],

  // =========================================================================
  // 构建优化配置
  // =========================================================================
  build: {
    // 生产环境移除 console.log（保留 warn 和 error）
    minify: 'esbuild',
    // 启用 CSS 代码分割
    cssCodeSplit: true,
    // 设置 chunk 大小警告阈值
    chunkSizeWarningLimit: 500,
    // Rollup 配置
    rollupOptions: {
      output: {
        // 手动分割代码块，优化加载
        // 注意：不要在 manualChunks 中包含 @tauri-apps/api，
        // 因为 SvelteKit SSR 会将其标记为外部模块
        manualChunks(id) {
          // 避免处理 @tauri-apps/api（SSR 时为外部模块）
          if (id.includes('@tauri-apps/api')) {
            return undefined;
          }
        },
      },
    },
  },

  // =========================================================================
  // esbuild 配置 - 生产环境移除 console
  // =========================================================================
  esbuild: {
    // 生产环境移除 console.log，保留 console.warn 和 console.error
    drop: process.env.NODE_ENV === 'production' ? ['console'] : [],
  },

  // =========================================================================
  // Tauri 开发环境配置
  // =========================================================================

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
    fs: {
      // 允许访问项目根目录下的 i18n 文件夹
      allow: ['..'],
    },
  },
}));
