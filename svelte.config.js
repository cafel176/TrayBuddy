// ========================================================================= //
// SvelteKit 配置
// ========================================================================= //
//
// Tauri 应用使用 adapter-static 进行静态预渲染 (SSG)
// 参考: https://v2.tauri.app/start/frontend/sveltekit/
//

import adapter from "@sveltejs/adapter-static";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

/** @type {import('@sveltejs/kit').Config} */
const config = {
  // 预处理器配置
  preprocess: vitePreprocess(),
  
  kit: {
    // 使用静态适配器（Tauri 不支持 SSR）
    adapter: adapter({
      // 输出目录（默认 build）
      pages: 'build',
      assets: 'build',
      // 回退页面（SPA 模式）
      fallback: undefined,
      // 预压缩资源
      precompress: false,
      // 严格模式
      strict: true
    }),
  },
  
  // =========================================================================
  // 编译器优化选项
  // =========================================================================
  compilerOptions: {
    // 开发环境启用可访问性警告
    // 生产环境可设为 false 减少代码体积
  }
};

export default config;
