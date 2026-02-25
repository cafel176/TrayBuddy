/// <reference types="vitest/config" />
import { defineConfig } from "vite";

import { sveltekit } from "@sveltejs/kit/vite";


const env = /** @type {any} */ (globalThis).process?.env ?? {};
const host = env.TAURI_DEV_HOST;
const isProd = env.NODE_ENV === "production";


// https://vitejs.dev/config/
export default defineConfig({
  plugins: [sveltekit()],

  resolve: {
    conditions: ["browser"],
  },

  environments: {

    client: {},
    ssr: {
      resolve: {
        conditions: ["browser"],
      },
    },
    test: {
      resolve: {
        conditions: ["browser"],
      },
    },
  },



  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{js,ts}", "src/**/*.{test,spec}.svelte"],
    coverage: {
      provider: "v8",
      reportsDirectory: "src/test/coverage",

      reporter: ["text-summary", "json-summary", "html"],

      include: [
        "src/routes/**",
        "src/lib/utils/**",
        "src/lib/bubble/**",
        "src/lib/i18n/**",
        "src/lib/trigger/**",
      ],
      exclude: [
        "**/node_modules/**",
        "**/src-tauri/**",
        "**/.svelte-kit/**",
        "**/other-tool/**",
        "**/tools-common/**",
        "**/mod-tool/**",
        "**/my-tool/**",
        "**/build/**",
        "**/mods/**",
        "**/mods_test/**",
        "**/tbuddy/**",
        "**/static/**",
        "**/提示词/**",
        "**/test_logs/**",
        "**/*.d.ts",
        "src/routes/animation/**",
        "src/routes/live2d/**",
        "src/routes/threed/**",
        "src/routes/pngremix/**",
      ],
    },
    server: {
      deps: {
        inline: [
          /svelte/,
          /@testing-library\/svelte/,
          /@testing-library\/svelte-core/,
        ],
      },
    },
  },


  ssr: {
    resolve: {
      conditions: ["browser"],
    },
  },

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
        /** @param {string} id */
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
  // esbuild 配置 - 生产环境移除部分 console
  // =========================================================================
  esbuild: {
    // 生产环境仅移除 console.log/info/debug/trace，保留 warn/error。
    // 注意：esbuild 的 drop:["console"] 会把 warn/error 也一起删掉。
    pure: isProd
      ? [
          "console.log",
          "console.info",
          "console.debug",
          "console.trace",
        ]
      : [],
    drop: isProd ? ["debugger"] : [],
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
});
