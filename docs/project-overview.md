# TrayBuddy 项目概览

## 一、项目概述

**TrayBuddy** 是一款 **Windows 桌面虚拟伴侣（桌宠）应用**，版本 `0.1.5`，由 `cafel` 开发，采用 MIT 许可证。它以系统托盘为锚点，在桌面上展示可交互的角色形象，支持多种角色渲染格式，并具备丰富的环境感知能力。

**核心定位**: 一个高度可定制、支持 Mod 扩展的桌面宠物系统。

---

## 二、技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| **前端框架** | SvelteKit 5 + TypeScript | 使用 Svelte 5 的 `$state` 响应式系统 |
| **后端框架** | Tauri 2 (Rust) | 桌面应用容器，提供系统级 API |
| **构建工具** | Vite 6 + pnpm | 前端构建；`@sveltejs/adapter-static` 静态适配 |
| **3D 渲染** | Three.js + @pixiv/three-vrm | VRM/PMX 3D 模型渲染 |
| **打包格式** | NSIS | Windows 安装程序，支持多语言安装界面 |
| **测试框架** | Vitest + @testing-library/svelte | 单元测试 + 组件测试 |
| **Windows API** | windows-rs 0.58 | 媒体控制、音频、进程、钩子、锁屏检测等 |

---

## 三、项目目录结构

```
d:\TrayBuddy\
├── src/                    # 前端源码（SvelteKit）
│   ├── routes/             # 页面路由（10+ 页面）
│   ├── lib/                # 前端模块库
│   └── test/               # 前端测试
├── src-tauri/              # 后端源码（Rust/Tauri）
│   └── src/
│       ├── modules/        # 核心功能模块（12 个）
│       └── commands/       # Tauri 命令（5 个文件）
├── mods/                   # Mod 包目录（含教程 Mod）
├── mod-tool/               # Mod 编辑器（独立 Web 工具）
├── other-tool/             # 其它辅助工具集（13 个工具）
├── tools-common/           # 工具共享代码
├── check-tool/             # 检查工具（Bundle 分析、内存分析）
├── config/                 # 运行时可配置文件
├── i18n/                   # 国际化资源（中/英/日）
├── sbuddy/                 # 加密 Mod 包样本
├── workflows/              # ComfyUI 工作流（图生视频）
└── docs/                   # 设计文档
```

---

## 四、后端架构（Rust）

### 4.1 全局状态架构

```
┌─────────────────────────────────────────────────────────────┐
│                      AppState (全局状态)                      │
│  ┌─────────────────┬─────────────────┬─────────────────┐    │
│  │ ResourceManager │  StateManager   │    Storage      │    │
│  │   (资源管理)     │   (状态管理)    │  (持久化存储)   │    │
│  └─────────────────┴─────────────────┴─────────────────┘    │
│                              │                               │
│  ┌─────────────────┬─────────┴───────┬─────────────────┐    │
│  │ MediaObserver   │ TriggerManager  │  Environment    │    │
│  │  (媒体监听)      │   (触发管理)    │   (环境信息)    │    │
│  └─────────────────┴─────────────────┴─────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

### 4.2 核心模块

| 模块 | 文件 | 功能 |
|------|------|------|
| **resource** | `resource.rs` | Mod 扫描/加载/卸载，资源路径解析，支持文件夹和 archive 两种来源 |
| **state** | `state.rs` | 角色状态机：状态切换、优先级、定时触发、锁机制 |
| **storage** | `storage.rs` | 用户设置和运行数据的 JSON 持久化 (`settings.json` / `info.json`) |
| **media_observer** | `media_observer.rs` | Windows GSMTC + Core Audio API 监听系统媒体播放 |
| **process_observer** | `process_observer.rs` | 进程名关键字匹配检测，触发"工作"事件 |
| **system_observer** | `system_observer.rs` | 全屏检测、锁屏/解锁检测（WTS 会话 API） |
| **environment** | `environment.rs` | 时间/日期/季节/地理位置/天气（ip-api + wttr.in） |
| **trigger** | `trigger.rs` | 事件触发处理，支持权重随机和防重复 |
| **mod_archive** | `mod_archive.rs` | `.tbuddy`(ZIP) 和 `.sbuddy`(加密) 包的抽象读取层 |
| **event_manager** | `event_manager.rs` | 统一事件发送管理，规范前后端通信 |
| **constants** | `constants.rs` | 全局常量：窗口标签、尺寸、状态名、事件名、超时值 |
| **utils/** | 6 文件 | HTTP、文件系统、i18n、OS 版本、线程管理、窗口操作 |

### 4.3 命令模块 (commands/)

| 文件 | 功能 |
|------|------|
| `mod.rs` | 用户设置、环境信息、窗口管理、媒体调试、备忘录/提醒等命令 |
| `mod_archive_commands.rs` | Mod 包导入/导出/检查、.tbuddy/.sbuddy 处理 |
| `mod_resource_commands.rs` | Mod 资源查询（状态、触发器、素材、文本、音频） |
| `window_system_commands.rs` | 窗口操作（缩放、位置、光标、右键菜单） |
| `open_with_commands.rs` | 打开外部路径 |

---

## 五、前端架构（SvelteKit）

### 5.1 页面路由

| 路由 | 功能 |
|------|------|
| `/` (main) | **调试主页面** — 9 个 Tab：资源管理、状态管理、触发器、环境信息、媒体、进程、系统、运行状态、布局 |
| `/animation` | **序列帧动画窗口** — 桌面宠物的核心渲染窗口（Sprite 精灵动画） |
| `/live2d` | **Live2D 渲染窗口** — Cubism 模型渲染 |
| `/pngremix` | **PngRemix 渲染窗口** — PngRemix 格式模型 |
| `/threed` | **3D 渲染窗口** — VRM/PMX 模型（Three.js） |
| `/mods` | **Mod 管理器** — 浏览、加载、导入、导出 Mod |
| `/settings` | **用户设置** |
| `/about` | **关于页面** |
| `/memo` | **备忘录** — 每次解锁屏幕时弹出 |
| `/reminder` | **定时提醒管理** |
| `/reminder_alert` | **提醒弹窗** |

### 5.2 前端核心模块 (`src/lib/`)

| 模块 | 功能 |
|------|------|
| `animation/SpriteAnimator.ts` | 序列帧精灵动画播放器 |
| `animation/Live2DPlayer.ts` | Live2D Cubism 模型播放器 |
| `animation/PngRemixPlayer.ts` | PngRemix 模型播放器 |
| `animation/ThreeDPlayer.ts` | 3D VRM/PMX 模型播放器 |
| `animation/WindowCore.ts` | 动画窗口核心（鼠标交互、拖拽、位置管理） |
| `animation/mmd/` | MMD 加载器和着色器（PMX 支持） |
| `audio/AudioManager.ts` | 音频管理（语音播放、音量控制） |
| `bubble/` | 对话气泡系统（气泡管理、打字机效果、Markdown、分支选项） |
| `trigger/TriggerManager.ts` | 前端触发器管理 |
| `i18n/` | 国际化（加载语言文件、响应切换） |
| `types/asset.ts` | 前后端共享类型定义 |
| `utils/` | LRU 缓存、Mod 资源 URL、路径处理 |
| `components/` | 8 个调试面板组件 |

---

## 六、Mod 系统

### 6.1 支持的 Mod 类型

| 类型 | `mod_type` | 渲染引擎 | 资源格式 |
|------|-----------|---------|---------|
| **序列帧** | `sequence` | Canvas Sprite Sheet | WebP/PNG 精灵图 |
| **Live2D** | `live2d` | Cubism SDK (JS) | .moc3/.model3.json/.motion3.json |
| **PngRemix** | `pngremix` | 自定义渲染器 | .pngRemix 二进制文件 |
| **3D** | `3d` | Three.js + VRM | .vrm/.pmx + .vrma/.vmd |

### 6.2 Mod 目录结构

```
mods/<mod_id>/
├── manifest.json        # 核心配置：状态机、触发器、角色设置
├── preview.webp         # 预览图
├── icon.ico             # 托盘图标
├── bubble_style.json    # [可选] 气泡样式
├── asset/               # 动画资源（按类型不同）
├── audio/<lang>/        # 多语言语音
└── text/<lang>/         # 多语言文本（info + speech）
```

### 6.3 状态机系统

Mod 的核心是一套**有限状态机**：

- **重要状态 (important_states)**: `idle`、`silence`、`music`、`dragging`、`birthday`、`firstday` 及其过渡态
- **普通状态 (states)**: Mod 创作者自定义的对话/动作状态
- **触发器 (triggers)**: 定义 `click`、`login`、`music_start`、`drag_start`、`keydown:<Key>` 等事件到状态的映射
- **分支对话**: 状态可包含 `branch` 数组实现交互式对话选项
- **定时触发**: 持久状态可设置 `trigger_time` + `trigger_rate` 随机切换子状态
- **条件触发**: 支持按日期/时间/计数器/气温/天气/运行时长限制状态触发

### 6.4 Mod 打包格式

| 格式 | 扩展名 | 说明 |
|------|--------|------|
| **tbuddy** | `.tbuddy` | 普通 ZIP 归档，系统关联双击可直接导入 |
| **sbuddy** | `.sbuddy` | 加密归档（文件头 `SBUDDY01`），需要嵌入式解密工具处理 |

系统通过 `tbuddy-asset://` 自定义协议从内存中的 archive 流式返回资源，支持单实例多 Mod 切换。

---

## 七、工具链

### 7.1 Mod 编辑器 (`mod-tool/`)

独立的 Web 应用（HTML + JS），功能包括：
- 可视化编辑 `manifest.json`（状态、触发器、配置）
- Mod 模板生成 (`template/`)
- 内置教程 (`tutorial.html`)
- 三语国际化 (中/英/日)
- 通过 `dev-server.mjs` 可本地启动编辑器

### 7.2 辅助工具集 (`other-tool/`)

包含 **13 个独立 Web 工具**，覆盖 Mod 制作的完整流程：

| 工具 | 功能 |
|------|------|
| gif 提取序列帧 | 从 GIF 提取帧序列 |
| 视频提取序列帧 | 从视频文件提取帧 |
| spritesheet 生成 | 将帧序列合并为精灵图 |
| spritesheet 切分 | 将精灵图拆分为单帧 |
| spritesheet 压缩 | 精灵图压缩优化 |
| 序列帧预览 | 预览动画效果 |
| 序列帧对齐工具 | 帧对齐调整 |
| 批量裁切缩放 | 批量图片处理 |
| png 转 ico | 图标格式转换 |
| live2d 导出 | Live2D 模型导出/配置 |
| pngRemix 预览 | PngRemix 模型预览 |
| 模型预览 | 3D 模型预览 |

### 7.3 检查工具 (`check-tool/`)

| 工具 | 功能 |
|------|------|
| bundle_analyzer | 安装包体积分析（PowerShell 脚本） |
| memory_profile | 运行时内存采样分析（PowerShell 脚本） |

### 7.4 公共工具 (`tools-common/`)

- `dev-server-core.mjs` — 统一的开发服务器核心
- `i18n-helper.js` — 通用国际化辅助（供所有工具使用）
- `download-blob.js` — 文件下载辅助
- `open-tool-common.bat` — 统一的工具启动脚本

---

## 八、配置系统

| 文件 | 功能 |
|------|------|
| `config/media_observer_keywords.json` | 媒体应用进程名关键词（Spotify、QQ音乐、foobar2000 等 21 个） |
| `config/process_observer_keywords.json` | 工作应用进程名关键词（Word、Photoshop、Unity、VS Code 等 27 个） |

这些配置随应用打包，用户可在安装目录修改以自定义识别规则。

---

## 九、国际化

支持 **3 种语言**：
- `zh.json` — 简体中文
- `en.json` — 英语
- `jp.json` — 日语

覆盖范围：应用界面、调试面板、设置项、Mod 管理器、托盘菜单、安装程序界面等所有用户可见文本。

---

## 十、特色功能

1. **多格式角色渲染**: 同时支持序列帧、Live2D、PngRemix、3D(VRM/PMX) 四种格式
2. **丰富的环境感知**:
   - 系统媒体播放检测（GSMTC + Core Audio）
   - 进程检测（识别工作应用触发对应状态）
   - 全屏检测（自动进入免打扰模式）
   - 锁屏/解锁检测
   - 地理位置和天气获取
   - 日期/时间/季节判断
3. **完整的状态机系统**: 带优先级、条件触发（日期/时间/计数器/气温/天气/运行时长）、分支对话
4. **全局输入监听**: 支持非聚焦状态的全局键盘/鼠标事件（Windows Hook）
5. **Mod 生态系统**:
   - 文件夹 Mod + `.tbuddy` 包 + `.sbuddy` 加密包
   - 自定义协议 `tbuddy-asset://` 从内存流式加载资源
   - 双击文件关联自动导入
   - 单实例 + 参数转发
6. **完整工具链**: 13+ 个辅助工具覆盖从素材制作到 Mod 发布的全流程
7. **主播模式**: 兼容 B 站直播姬窗口捕捉
8. **备忘录 + 定时提醒**: 实用的桌面小工具功能
9. **对话气泡系统**: 打字机效果、简易 Markdown、分支选项、自定义样式
10. **数据持久化**: 使用统计（启动次数、使用时长、点击次数）、Mod 独立计数器、窗口位置记忆
