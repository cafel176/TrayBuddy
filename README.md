<p align="center">
  <img src="src-tauri/icons/icon.ico" alt="TrayBuddy Logo" width="80" height="80">
</p>

<h1 align="center">TrayBuddy</h1>

<p align="center">
  <a href="#简体中文">简体中文</a> ｜ <a href="#english">English</a> ｜ <a href="#日本語">日本語</a>
</p>

<p align="center">
  <img alt="Version" src="https://img.shields.io/badge/version-0.1.5-blue.svg" />
  <img alt="License" src="https://img.shields.io/badge/license-MIT-green.svg" />
  <img alt="Platform" src="https://img.shields.io/badge/platform-Windows-lightgrey.svg" />
  <img alt="Tauri" src="https://img.shields.io/badge/Tauri-2-orange.svg" />
  <img alt="Svelte" src="https://img.shields.io/badge/Svelte-5-red.svg" />
  <img alt="Rust" src="https://img.shields.io/badge/Rust-2021-brown.svg" />
</p>

<br>

<!-- ============================================================ -->
<!-- 简体中文                                                       -->
<!-- ============================================================ -->

<a id="zh-适用人群"></a>

## 适用人群

如果你：

- **喜欢不同类型桌宠来回换，又不想装很多软件**

- **想做桌宠，有动画，或有配音，或有文本，但不想写代码**

- **只想展示自己的动画模型，但又不想被别人滥用**

- **是专业桌宠作者，用惯用的工具做完后，可以顺手打个包给用户多一种选择**

那么这个项目可能会适合你

<br>

<a id="zh-简介"></a>

## 简介

**TrayBuddy**是一款支持 **多种动画类型、包加密、高度自定义** 的桌宠应用，致力于让用户和创作者都能获得出色的体验

1. 支持 4 种动画格式：**序列帧(差分图，gif，spritesheet)、Live2D、PngRemix、3D模型(vrm/pmx)**

2. 支持对mod进行包加密

3. 支持复杂的对话事件链和语音配置

4. 支持多种事件：键盘鼠标、播放音乐、电脑解锁、工作程序启动、拖拽、全屏应用启动、天气变换、时间变化、长时间使用电脑、生日问候 等

5. 完整的 Mod 创作工具链，填表式编辑器不需要写代码

6. 支持多种 Mod 切换和单一 Mod 的多版本管理

7. 辅助功能：备忘录和定时提醒

<br>

> [!TIP]
> 本项目仍处于早期阶段，如果您发现问题，欢迎反馈给我们
> 联系我们：QQ群: 578258773   Bilibili: _Cafel_

<br>

<a id="zh-功能特性"></a>

## 功能特性

### 动画格式

TrayBuddy 统一管理 4 种不同的动画格式：

我们提供一整套工具链用于将 差分图/gif/视频 处理成spritesheet用于程序内动画，其他三种格式直接使用原本文件，编辑器内支持对文件进行解析

| 格式         | 资源类型               | 说明                                                       |
| ------------ | ---------------------- | ---------------------------------------------------------- |
| **序列帧**   | WebP / PNG             | 支持差分图/gif/视频/spritesheet，有一整套工具链处理动画       |
| **Live2D**   | live2d资源包           | live2d动画格式，支持物理/表情/动作                            |
| **PngRemix** | pngRemix文件           | pngtuber remix的自定义格式                                   |
| **3D**       | vrm / pmx + 动作文件   | 支持 VRM 和 MMD PMX 3D 模型                                 |

<br>

### 包加密

我们的程序支持将您的作品打包为一个加密文件sbuddy，这种格式只能被程序本身使用，编辑器无法打开，也无法被简单的解包拿到内部的资源

如果您发现我们的加密解密存在漏洞，欢迎反馈给我们，我们将会非常感激

> [!TIP]
> 开源代码内不包括加密解密的部分，因此使用源码版将无法打包和加载sbuddy，如果您有相关的需求，请使用我们的release版本

### 对话和语言

我们的程序支持复杂的对话事件链和每句对话的语音配置，您可以使用我们的 Mod编辑器轻易的填表式完成这一目标

#### 状态机系统

- **有限状态机** — 每个 Mod 定义独立的状态机，支持状态优先级与切换锁
- **条件触发** — 按日期/时间/计数器/气温/天气/运行时长等条件限制触发
- **定时触发** — 持久状态可设置随机间隔自动切换子状态
- **事件触发** — 支持 `click`、`login`、`music_start`、`drag_start`、`keydown:<Key>` 等 16+ 种事件类型
- **全局输入** — 通过 Windows Hook 监听非聚焦状态的键盘/鼠标事件
- **防重复** — 可选的触发去重机制，避免连续重复状态

#### 实用工具

- **备忘录** — 每次解锁屏幕时自动弹出，也可手动查看
- **定时提醒** — 设置指定时间的弹窗提醒
- **使用统计** — 记录启动次数、使用时长、点击次数等数据
- **主播模式** — 兼容 B 站直播姬窗口捕捉

<a id="zh-角色渲染格式"></a>



<a id="zh-技术栈"></a>

### 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| 前端框架 | SvelteKit 5 + TypeScript | Svelte 5 响应式系统 |
| 后端框架 | Tauri 2 (Rust) | 桌面应用容器，提供系统级 API |
| 3D 渲染 | Three.js + @pixiv/three-vrm | VRM / PMX 3D 模型渲染 |
| 构建工具 | Vite 6 + pnpm | 前端构建，`@sveltejs/adapter-static` 静态适配 |
| 打包分发 | NSIS | Windows 安装程序，支持 4 种安装界面语言 |
| Windows API | windows-rs 0.58 | 媒体控制、音频、进程、钩子、锁屏检测等 |
| 测试框架 | Vitest + Cargo Test | 前端单元/组件测试 + 后端 Rust 测试 |

<a id="zh-系统要求"></a>

### 系统要求

- **操作系统**: Windows 10 (1809+) / Windows 11
- **运行时**: [WebView2 Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/)（Windows 11 已内置）
- **磁盘空间**: ~100 MB（不含 Mod 资源）

<a id="zh-安装"></a>

### 安装

1. 从 [Releases](../../releases) 下载最新版 `.exe` 安装程序
2. 运行安装程序，选择安装语言和目录
3. 安装完成后启动 TrayBuddy，角色将出现在桌面上
4. 右键系统托盘图标可访问设置和功能菜单

#### 安装 Mod

- **双击 `.tbuddy` 或 `.sbuddy` 文件**即可自动导入（已关联文件类型）
- 或通过 Mod 管理器手动浏览、导入

<a id="zh-从源码构建"></a>

### 从源码构建

#### 环境准备

运行一键环境安装脚本（需要管理员权限）：

```bash
setup-windows-build-env.bat
```

该脚本将自动安装：
- Node.js LTS
- Rust (via rustup)
- Visual Studio 2022 Build Tools (C++ workload)
- NSIS
- WebView2 Runtime

或手动安装：

| 依赖 | 最低版本 |
|------|---------|
| [Node.js](https://nodejs.org/) | 18+ |
| [Rust](https://rustup.rs/) | 1.75+ |
| [pnpm](https://pnpm.io/) | 8+ |
| [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) | 2022 |

#### 开发模式

```bash
# 安装前端依赖
pnpm install

# 启动开发模式（含热更新）
dev.bat
# 或手动执行
pnpm tauri dev
```

#### 构建发布版

```bash
release.bat
```

该脚本会：
1. 清理 release mods 目录
2. 使用 `pack-mods.ps1` 打包 Mod 为 `.tbuddy` 格式
3. 加密打包为 `.sbuddy` 格式（如适用）
4. 执行 `pnpm tauri build` 生成 NSIS 安装程序

构建产物输出到 `src-tauri/target/release/bundle/nsis/`。

<a id="zh-mod-系统"></a>

### Mod 系统

#### Mod 目录结构

```
mods/<mod_id>/
├── manifest.json          # 核心配置：状态机、触发器、角色设置（必需）
├── preview.webp           # 预览图
├── icon.ico               # 托盘图标
├── bubble_style.json      # 气泡样式自定义（可选）
├── asset/                 # 动画资源
│   ├── img.json           # 序列帧配置
│   ├── live2d.json        # Live2D 配置
│   ├── pngremix.json      # PngRemix 配置
│   ├── 3d.json            # 3D 模型配置
│   └── <资源文件...>
├── audio/<lang>/          # 多语言语音
└── text/<lang>/           # 多语言文本
    ├── info.json          # 信息文本
    └── speech.json        # 对话文本
```

#### manifest.json 核心概念

```jsonc
{
  "mod_id": "my-mod",
  "mod_type": "sequence",          // sequence | live2d | pngremix | 3d
  "important_states": {            // 内置重要状态
    "idle": { ... },               // 待机
    "silence": { ... },            // 静默
    "music": { ... },              // 音乐播放中
    "dragging": { ... }            // 拖拽中
  },
  "states": {                      // 自定义状态
    "greeting": {
      "priority": 5,
      "trigger_time": 60,          // 定时触发（秒）
      "branch": [...]              // 分支对话选项
    }
  },
  "triggers": {                    // 事件→状态映射
    "click": [{ "state": "greeting", "weight": 1 }],
    "music_start": [{ "state": "music" }],
    "keydown:F1": [{ "state": "help" }]
  }
}
```

#### Mod 打包格式

| 格式 | 扩展名 | 说明 |
|------|--------|------|
| tbuddy | `.tbuddy` | ZIP 归档，双击自动导入 |
| sbuddy | `.sbuddy` | 加密归档（`SBUDDY01` 文件头），保护 Mod 资源 |

系统通过 `tbuddy-asset://` 自定义协议从内存中的归档流式加载资源，无需解压到磁盘。

> 详细的 Mod 开发指南请参阅 `mods/mod-guide.md`

<a id="zh-工具链"></a>

### 工具链

TrayBuddy 提供完整的 Mod 创作工具链：

#### Mod 编辑器 (`mod-tool/`)

可视化编辑 Mod 配置的独立 Web 应用：
- 状态机编辑器
- 触发器配置
- Mod 模板生成
- 内置教程
- 支持三语界面

```bash
# 启动 Mod 编辑器
cd mod-tool && 打开-mod编辑器.bat
```

#### 辅助工具集 (`other-tool/`)

13 个独立 Web 工具，覆盖 Mod 制作全流程：

| 工具 | 功能 |
|------|------|
| GIF 提取序列帧 | 从 GIF 动图提取帧序列 |
| 视频提取序列帧 | 从视频文件提取帧序列 |
| Spritesheet 生成 | 将帧序列合并为精灵图 |
| Spritesheet 切分 | 将精灵图拆分为单帧 |
| Spritesheet 压缩 | 精灵图体积优化 |
| 序列帧预览 | 预览序列帧动画效果 |
| 序列帧对齐工具 | 帧对齐和偏移调整 |
| 批量裁切缩放 | 批量图片处理 |
| PNG 转 ICO | 图标格式转换 |
| Live2D 导出 | Live2D 模型导出与配置 |
| PngRemix 预览 | PngRemix 模型预览与调试 |
| 模型预览 | 3D VRM/PMX 模型预览 |

#### 检查工具 (`check-tool/`)

| 工具 | 功能 |
|------|------|
| Bundle Analyzer | 安装包体积分析 |
| Memory Profiler | 运行时内存采样分析 |

<a id="zh-项目结构"></a>

### 项目结构

```
TrayBuddy/
├── src/                        # 前端源码（SvelteKit + TypeScript）
│   ├── routes/                 # 页面路由（11 个页面）
│   │   ├── +page.svelte        #   调试主页面（9 个 Tab）
│   │   ├── animation/          #   序列帧渲染窗口
│   │   ├── live2d/             #   Live2D 渲染窗口
│   │   ├── pngremix/           #   PngRemix 渲染窗口
│   │   ├── threed/             #   3D 渲染窗口
│   │   ├── mods/               #   Mod 管理器
│   │   ├── settings/           #   用户设置
│   │   ├── memo/               #   备忘录
│   │   └── reminder/           #   定时提醒
│   ├── lib/                    # 前端核心模块
│   │   ├── animation/          #   动画播放器（4 种格式）+ 窗口核心
│   │   ├── audio/              #   音频管理
│   │   ├── bubble/             #   对话气泡系统
│   │   ├── trigger/            #   前端触发器
│   │   ├── i18n/               #   国际化
│   │   ├── types/              #   类型定义
│   │   ├── utils/              #   工具函数
│   │   └── components/         #   调试面板组件
│   └── test/                   # 前端测试
├── src-tauri/                  # 后端源码（Rust / Tauri 2）
│   └── src/
│       ├── lib.rs              #   应用入口、命令注册、自定义协议
│       ├── app_state.rs        #   全局状态管理
│       ├── modules/            #   核心功能模块
│       │   ├── resource.rs     #     Mod 资源管理
│       │   ├── state.rs        #     状态机引擎
│       │   ├── media_observer  #     媒体播放监听
│       │   ├── process_observer#     进程检测
│       │   ├── system_observer #     系统事件监听
│       │   ├── environment.rs  #     环境信息（天气/位置）
│       │   ├── trigger.rs      #     事件触发处理
│       │   ├── storage.rs      #     持久化存储
│       │   ├── mod_archive.rs  #     Mod 包读取层
│       │   └── utils/          #     工具函数
│       └── commands/           #   Tauri 命令（前后端通信）
├── config/                     # 运行时配置（媒体/进程关键词）
├── i18n/                       # 国际化资源
├── mods/                       # Mod 目录（含教程 Mod）
├── mod-tool/                   # Mod 编辑器
├── other-tool/                 # 辅助工具集（13 个）
├── tools-common/               # 工具共享代码
├── check-tool/                 # 检查工具
├── docs/                       # 设计文档
└── workflows/                  # ComfyUI 工作流
```

#### 后端架构

```
┌──────────────────────────────────────────────────────┐
│                   AppState（全局状态）                  │
│  ┌──────────────┬──────────────┬──────────────┐      │
│  │ ResourceMgr  │  StateMgr    │   Storage    │      │
│  │  (资源管理)   │  (状态管理)   │  (持久化)    │      │
│  └──────────────┴──────────────┴──────────────┘      │
│  ┌──────────────┬──────────────┬──────────────┐      │
│  │ MediaObserver│ ProcessObs   │ SystemObs    │      │
│  │  (媒体监听)   │  (进程检测)   │  (系统事件)  │      │
│  └──────────────┴──────────────┴──────────────┘      │
│  ┌──────────────┬──────────────┐                     │
│  │ Environment  │ ArchiveStore │                     │
│  │  (环境信息)   │  (归档缓存)  │                     │
│  └──────────────┴──────────────┘                     │
└──────────────────────────────────────────────────────┘
```

<a id="zh-国际化"></a>

### 国际化

支持 3 种语言，覆盖应用全部可见文本：

| 语言 | 文件 | 覆盖范围 |
|------|------|---------|
| 简体中文 | `i18n/zh.json` | UI、菜单、调试面板、设置、NSIS 安装器 |
| English | `i18n/en.json` | 同上 |
| 日本語 | `i18n/jp.json` | 同上 |

所有工具（Mod 编辑器、辅助工具集）同样支持三语切换。

<a id="zh-开发指南"></a>

### 开发指南

#### 日常开发

```bash
# 安装依赖
pnpm install

# 开发模式（热更新）
pnpm tauri dev

# 仅前端开发
pnpm dev

# 类型检查
pnpm check
```

#### 自定义配置

应用安装后，用户可修改以下配置文件来自定义行为：

| 配置文件 | 说明 |
|---------|------|
| `config/media_observer_keywords.json` | 媒体应用进程名关键词（Spotify、QQ 音乐、网易云等） |
| `config/process_observer_keywords.json` | 工作应用进程名关键词（VS Code、Photoshop、Unity 等） |

<a id="zh-测试"></a>

### 测试

```bash
# 运行全部前端测试
pnpm test:run

# 前端测试（Watch 模式）
pnpm test:watch

# 前端测试覆盖率
pnpm test:coverage

# 运行后端 Rust 测试
cd src-tauri && cargo test

# 一键全部测试（前端 + 后端 + 覆盖率）
test.bat
```

<a id="zh-许可证"></a>

### 许可证

本项目采用 [MIT License](LICENSE) 开源许可证。

<p align="right"><a href="#简体中文">⬆ 返回中文顶部</a></p>

---

<!-- ============================================================ -->
<!-- English                                                       -->
<!-- ============================================================ -->

<a id="english"></a>

## English

A highly customizable, mod-extensible Windows desktop virtual companion (desktop pet) application.

### Table of Contents

- [Introduction](#en-introduction)
- [Features](#en-features)
- [Character Rendering Formats](#en-rendering-formats)
- [Tech Stack](#en-tech-stack)
- [System Requirements](#en-system-requirements)
- [Installation](#en-installation)
- [Building from Source](#en-building-from-source)
- [Mod System](#en-mod-system)
- [Toolchain](#en-toolchain)
- [Project Structure](#en-project-structure)
- [Internationalization](#en-i18n)
- [Development Guide](#en-development-guide)
- [Testing](#en-testing)
- [License](#en-license)

---

<a id="en-introduction"></a>

### Introduction

**TrayBuddy** is a desktop virtual companion application anchored to the system tray. It displays interactive character figures on the desktop, supports 4 character rendering formats, has rich environment-awareness capabilities (media playback, process detection, weather, calendar, etc.), and provides a complete Mod ecosystem and creation toolchain for both users and creators.

<a id="en-features"></a>

### Features

#### Character Interaction

- **Desktop Character Display** — Transparent borderless window, character always on top
- **Mouse Pass-through** — Pixel-level transparent area pass-through without affecting desktop operations
- **Drag & Move** — Freely drag the character to any position on the desktop
- **Tray Snap** — Character automatically snaps near the system tray area
- **Speech Bubbles** — Typewriter text effect, simple Markdown rendering, branching dialogue options, custom bubble styles
- **Voice Playback** — Play associated voice files on state transitions

#### Environment Awareness

- **Media Monitoring** — Detect system media playback via Windows GSMTC + Core Audio API
- **Process Detection** — Recognize work applications (IDEs, Office, design tools, etc.) and auto-trigger corresponding events
- **Fullscreen Detection** — Automatically enter do-not-disturb mode when fullscreen apps are detected
- **Lock/Unlock** — Detect screen lock state via WTS Session API
- **Weather & Location** — IP-based geolocation for weather info, supports weather/temperature conditional triggers
- **Time Awareness** — Date, time period, season, holidays, birthday and other temporal triggers

#### State Machine System

- **Finite State Machine** — Each Mod defines its own state machine with priority and switch locks
- **Conditional Triggers** — Trigger based on date/time/counter/temperature/weather/uptime conditions
- **Timed Triggers** — Persistent states can auto-switch sub-states at random intervals
- **Event Triggers** — Supports 16+ event types including `click`, `login`, `music_start`, `drag_start`, `keydown:<Key>`
- **Global Input** — Listen for keyboard/mouse events even when unfocused via Windows Hooks
- **De-duplication** — Optional trigger de-duplication to avoid consecutive repeated states

#### Utilities

- **Memo** — Auto-popup on screen unlock, also viewable manually
- **Timed Reminders** — Set popup reminders for specific times
- **Usage Statistics** — Track launch count, usage duration, click count, etc.
- **Streamer Mode** — Compatible with Bilibili Live capture

<a id="en-rendering-formats"></a>

### Character Rendering Formats

TrayBuddy manages 4 different character rendering formats:

| Format | Rendering Engine | Resource Type | Description |
|--------|-----------------|---------------|-------------|
| **Sprite Sheet** | Canvas 2D Sprite Sheet | WebP / PNG sprite sheets | Easiest to start with, ideal for pixel art or simple animations |
| **Live2D** | Cubism SDK + PixiJS | .moc3 / .model3.json | High-quality 2D characters with physics/expressions/motions |
| **PngRemix** | Canvas 2D Custom Renderer | .pngRemix binary | Custom format exported from Godot 4 |
| **3D** | Three.js + @pixiv/three-vrm | .vrm / .pmx + motion files | Supports VRM and MMD PMX 3D models |

<a id="en-tech-stack"></a>

### Tech Stack

| Layer | Technology | Description |
|-------|-----------|-------------|
| Frontend | SvelteKit 5 + TypeScript | Svelte 5 reactive system |
| Backend | Tauri 2 (Rust) | Desktop app container with system-level APIs |
| 3D Rendering | Three.js + @pixiv/three-vrm | VRM / PMX 3D model rendering |
| Build Tool | Vite 6 + pnpm | Frontend build with `@sveltejs/adapter-static` |
| Packaging | NSIS | Windows installer with 4 UI languages |
| Windows API | windows-rs 0.58 | Media control, audio, process, hooks, lock detection, etc. |
| Testing | Vitest + Cargo Test | Frontend unit/component tests + backend Rust tests |

<a id="en-system-requirements"></a>

### System Requirements

- **OS**: Windows 10 (1809+) / Windows 11
- **Runtime**: [WebView2 Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) (built-in on Windows 11)
- **Disk Space**: ~100 MB (excluding Mod resources)

<a id="en-installation"></a>

### Installation

1. Download the latest `.exe` installer from [Releases](../../releases)
2. Run the installer, select language and directory
3. After installation, launch TrayBuddy — the character will appear on the desktop
4. Right-click the system tray icon to access settings and features

#### Installing Mods

- **Double-click `.tbuddy` or `.sbuddy` files** to auto-import (file associations registered)
- Or manually browse and import through the Mod Manager

<a id="en-building-from-source"></a>

### Building from Source

#### Prerequisites

Run the one-click environment setup script (requires admin privileges):

```bash
setup-windows-build-env.bat
```

This script will auto-install:
- Node.js LTS
- Rust (via rustup)
- Visual Studio 2022 Build Tools (C++ workload)
- NSIS
- WebView2 Runtime

Or install manually:

| Dependency | Minimum Version |
|-----------|----------------|
| [Node.js](https://nodejs.org/) | 18+ |
| [Rust](https://rustup.rs/) | 1.75+ |
| [pnpm](https://pnpm.io/) | 8+ |
| [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) | 2022 |

#### Development Mode

```bash
# Install frontend dependencies
pnpm install

# Start development mode (with hot reload)
dev.bat
# Or manually
pnpm tauri dev
```

#### Production Build

```bash
release.bat
```

This script will:
1. Clean release mods directory
2. Pack Mods into `.tbuddy` format using `pack-mods.ps1`
3. Encrypt into `.sbuddy` format (if applicable)
4. Run `pnpm tauri build` to generate the NSIS installer

Build output goes to `src-tauri/target/release/bundle/nsis/`.

<a id="en-mod-system"></a>

### Mod System

#### Mod Directory Structure

```
mods/<mod_id>/
├── manifest.json          # Core config: state machine, triggers, character settings (required)
├── preview.webp           # Preview image
├── icon.ico               # Tray icon
├── bubble_style.json      # Bubble style customization (optional)
├── asset/                 # Animation resources
│   ├── img.json           # Sprite sheet config
│   ├── live2d.json        # Live2D config
│   ├── pngremix.json      # PngRemix config
│   ├── 3d.json            # 3D model config
│   └── <resource files...>
├── audio/<lang>/          # Multi-language voice
└── text/<lang>/           # Multi-language text
    ├── info.json          # Info text
    └── speech.json        # Dialogue text
```

#### manifest.json Core Concepts

```jsonc
{
  "mod_id": "my-mod",
  "mod_type": "sequence",          // sequence | live2d | pngremix | 3d
  "important_states": {            // Built-in important states
    "idle": { ... },               // Idle
    "silence": { ... },            // Silent
    "music": { ... },              // Music playing
    "dragging": { ... }            // Being dragged
  },
  "states": {                      // Custom states
    "greeting": {
      "priority": 5,
      "trigger_time": 60,          // Timed trigger (seconds)
      "branch": [...]              // Branching dialogue options
    }
  },
  "triggers": {                    // Event → State mapping
    "click": [{ "state": "greeting", "weight": 1 }],
    "music_start": [{ "state": "music" }],
    "keydown:F1": [{ "state": "help" }]
  }
}
```

#### Mod Package Formats

| Format | Extension | Description |
|--------|-----------|-------------|
| tbuddy | `.tbuddy` | ZIP archive, double-click to auto-import |
| sbuddy | `.sbuddy` | Encrypted archive (`SBUDDY01` header), protects Mod resources |

The system streams resources from in-memory archives via the `tbuddy-asset://` custom protocol — no disk extraction needed.

> For detailed Mod development guide, see `mods/mod-guide.md`

<a id="en-toolchain"></a>

### Toolchain

TrayBuddy provides a complete Mod creation toolchain:

#### Mod Editor (`mod-tool/`)

A standalone web application for visual Mod editing:
- State machine editor
- Trigger configuration
- Mod template generation
- Built-in tutorial
- Trilingual interface support

```bash
# Launch the Mod Editor
cd mod-tool && 打开-mod编辑器.bat
```

#### Auxiliary Tools (`other-tool/`)

13 standalone web tools covering the full Mod creation workflow:

| Tool | Function |
|------|----------|
| GIF Frame Extractor | Extract frame sequences from GIF |
| Video Frame Extractor | Extract frames from video files |
| Spritesheet Generator | Merge frames into sprite sheets |
| Spritesheet Splitter | Split sprite sheets into individual frames |
| Spritesheet Compressor | Optimize sprite sheet file size |
| Sequence Preview | Preview sequence frame animations |
| Sequence Alignment Tool | Frame alignment and offset adjustment |
| Batch Crop & Resize | Batch image processing |
| PNG to ICO | Icon format conversion |
| Live2D Export | Live2D model export and configuration |
| PngRemix Preview | PngRemix model preview and debugging |
| Model Preview | 3D VRM/PMX model preview |

#### Check Tools (`check-tool/`)

| Tool | Function |
|------|----------|
| Bundle Analyzer | Installation package size analysis |
| Memory Profiler | Runtime memory sampling analysis |

<a id="en-project-structure"></a>

### Project Structure

```
TrayBuddy/
├── src/                        # Frontend source (SvelteKit + TypeScript)
│   ├── routes/                 # Page routes (11 pages)
│   │   ├── +page.svelte        #   Debug main page (9 Tabs)
│   │   ├── animation/          #   Sprite rendering window
│   │   ├── live2d/             #   Live2D rendering window
│   │   ├── pngremix/           #   PngRemix rendering window
│   │   ├── threed/             #   3D rendering window
│   │   ├── mods/               #   Mod Manager
│   │   ├── settings/           #   User Settings
│   │   ├── memo/               #   Memo
│   │   └── reminder/           #   Timed Reminders
│   ├── lib/                    # Frontend core modules
│   │   ├── animation/          #   Animation players (4 formats) + Window core
│   │   ├── audio/              #   Audio management
│   │   ├── bubble/             #   Speech bubble system
│   │   ├── trigger/            #   Frontend triggers
│   │   ├── i18n/               #   Internationalization
│   │   ├── types/              #   Type definitions
│   │   ├── utils/              #   Utility functions
│   │   └── components/         #   Debug panel components
│   └── test/                   # Frontend tests
├── src-tauri/                  # Backend source (Rust / Tauri 2)
│   └── src/
│       ├── lib.rs              #   App entry, command registration, custom protocol
│       ├── app_state.rs        #   Global state management
│       ├── modules/            #   Core functional modules
│       │   ├── resource.rs     #     Mod resource management
│       │   ├── state.rs        #     State machine engine
│       │   ├── media_observer  #     Media playback monitoring
│       │   ├── process_observer#     Process detection
│       │   ├── system_observer #     System event monitoring
│       │   ├── environment.rs  #     Environment info (weather/location)
│       │   ├── trigger.rs      #     Event trigger handling
│       │   ├── storage.rs      #     Persistent storage
│       │   ├── mod_archive.rs  #     Mod package reader
│       │   └── utils/          #     Utility functions
│       └── commands/           #   Tauri commands (frontend-backend communication)
├── config/                     # Runtime config (media/process keywords)
├── i18n/                       # I18n resources
├── mods/                       # Mod directory (includes tutorial Mod)
├── mod-tool/                   # Mod Editor
├── other-tool/                 # Auxiliary tools (13)
├── tools-common/               # Shared tool code
├── check-tool/                 # Check tools
├── docs/                       # Design documents
└── workflows/                  # ComfyUI workflows
```

<a id="en-i18n"></a>

### Internationalization

Supports 3 languages, covering all visible text in the application:

| Language | File | Coverage |
|----------|------|----------|
| Simplified Chinese | `i18n/zh.json` | UI, menus, debug panels, settings, NSIS installer |
| English | `i18n/en.json` | Same as above |
| Japanese | `i18n/jp.json` | Same as above |

All tools (Mod Editor, auxiliary tools) also support trilingual switching.

<a id="en-development-guide"></a>

### Development Guide

#### Daily Development

```bash
# Install dependencies
pnpm install

# Development mode (hot reload)
pnpm tauri dev

# Frontend only
pnpm dev

# Type checking
pnpm check
```

#### Custom Configuration

After installation, users can modify the following config files to customize behavior:

| Config File | Description |
|-------------|-------------|
| `config/media_observer_keywords.json` | Media app process name keywords (Spotify, QQ Music, NetEase Cloud, etc.) |
| `config/process_observer_keywords.json` | Work app process name keywords (VS Code, Photoshop, Unity, etc.) |

<a id="en-testing"></a>

### Testing

```bash
# Run all frontend tests
pnpm test:run

# Frontend tests (watch mode)
pnpm test:watch

# Frontend test coverage
pnpm test:coverage

# Run backend Rust tests
cd src-tauri && cargo test

# One-click full test suite (frontend + backend + coverage)
test.bat
```

<a id="en-license"></a>

### License

This project is licensed under the [MIT License](LICENSE).

<p align="right"><a href="#english">⬆ Back to English top</a></p>

---

<!-- ============================================================ -->
<!-- 日本語                                                         -->
<!-- ============================================================ -->

<a id="日本語"></a>

## 日本語

高度にカスタマイズ可能な、Mod拡張対応のWindowsデスクトップ仮想コンパニオン（デスクトップペット）アプリケーション

### 目次

- [はじめに](#jp-はじめに)
- [機能](#jp-機能)
- [キャラクターレンダリング形式](#jp-レンダリング形式)
- [技術スタック](#jp-技術スタック)
- [システム要件](#jp-システム要件)
- [インストール](#jp-インストール)
- [ソースからビルド](#jp-ソースからビルド)
- [Modシステム](#jp-modシステム)
- [ツールチェーン](#jp-ツールチェーン)
- [プロジェクト構成](#jp-プロジェクト構成)
- [国際化](#jp-国際化)
- [開発ガイド](#jp-開発ガイド)
- [テスト](#jp-テスト)
- [ライセンス](#jp-ライセンス)

---

<a id="jp-はじめに"></a>

### はじめに

**TrayBuddy** は、システムトレイをアンカーポイントとしたデスクトップ仮想コンパニオンアプリケーションです。デスクトップ上にインタラクティブなキャラクターを表示し、4種類のキャラクターレンダリング形式に対応。メディア再生、プロセス検出、天気、カレンダーなど豊富な環境認識機能を備え、完全なModエコシステムと制作ツールチェーンを提供し、ユーザーとクリエイター双方に優れた体験を届けます。

<a id="jp-機能"></a>

### 機能

#### キャラクターインタラクション

- **デスクトップキャラクター表示** — 透明ボーダーレスウィンドウ、常に最前面に表示
- **マウス透過** — ピクセルレベルの透明領域自動透過、デスクトップ操作に影響なし
- **ドラッグ移動** — キャラクターをデスクトップの任意の位置にドラッグ可能
- **トレイスナップ** — システムトレイ領域に自動的にスナップ
- **吹き出し** — タイプライター効果、簡易Markdownレンダリング、分岐ダイアログ、カスタムスタイル
- **音声再生** — 状態遷移時に関連音声ファイルを再生

#### 環境認識

- **メディア監視** — Windows GSMTC + Core Audio APIでシステムメディア再生状態を検出
- **プロセス検出** — 作業アプリケーション（IDE、Office、デザインツール等）を認識し、対応イベントを自動トリガー
- **フルスクリーン検出** — フルスクリーンアプリ検出時、自動的にサイレントモードに移行
- **ロック/アンロック** — WTSセッションAPIで画面ロック状態を検出
- **天気＆位置情報** — IPベースの位置情報で天気取得、天気/気温条件トリガーに対応
- **時間認識** — 日付、時間帯、季節、祝日、誕生日などの時間次元トリガー

#### ステートマシンシステム

- **有限状態機械** — 各Modが独立した状態機械を定義、優先度と切替ロック対応
- **条件トリガー** — 日付/時刻/カウンター/気温/天気/稼働時間による条件付きトリガー
- **タイマートリガー** — 永続状態はランダム間隔でサブステートを自動切替可能
- **イベントトリガー** — `click`、`login`、`music_start`、`drag_start`、`keydown:<Key>` など16以上のイベントタイプに対応
- **グローバル入力** — Windows Hookでフォーカス外のキーボード/マウスイベントを監視
- **重複防止** — 連続した重複状態を避けるオプションの重複排除メカニズム

#### ユーティリティ

- **メモ** — 画面アンロック時に自動ポップアップ、手動表示も可能
- **タイマーリマインダー** — 指定時刻のポップアップリマインダー設定
- **使用統計** — 起動回数、使用時間、クリック数などを記録
- **配信者モード** — ビリビリライブのウィンドウキャプチャに対応

<a id="jp-レンダリング形式"></a>

### キャラクターレンダリング形式

TrayBuddyは4種類の異なるキャラクターレンダリング形式を統合管理します：

| 形式 | レンダリングエンジン | リソースタイプ | 説明 |
|------|-------------------|--------------|------|
| **シーケンスフレーム** | Canvas 2D Sprite Sheet | WebP / PNG スプライトシート | 最も簡単、ピクセルアートやシンプルなアニメに最適 |
| **Live2D** | Cubism SDK + PixiJS | .moc3 / .model3.json | 高品質2Dキャラクター、物理/表情/モーション対応 |
| **PngRemix** | Canvas 2D カスタムレンダラー | .pngRemix バイナリ | Godot 4からエクスポートされたカスタム形式 |
| **3D** | Three.js + @pixiv/three-vrm | .vrm / .pmx + モーションファイル | VRMとMMD PMX 3Dモデルに対応 |

<a id="jp-技術スタック"></a>

### 技術スタック

| レイヤー | 技術 | 説明 |
|---------|------|------|
| フロントエンド | SvelteKit 5 + TypeScript | Svelte 5 リアクティブシステム |
| バックエンド | Tauri 2 (Rust) | システムレベルAPIを提供するデスクトップアプリコンテナ |
| 3Dレンダリング | Three.js + @pixiv/three-vrm | VRM / PMX 3Dモデルレンダリング |
| ビルドツール | Vite 6 + pnpm | `@sveltejs/adapter-static` によるフロントエンドビルド |
| パッケージング | NSIS | 4言語UIのWindowsインストーラー |
| Windows API | windows-rs 0.58 | メディア制御、オーディオ、プロセス、フック、ロック検出等 |
| テスト | Vitest + Cargo Test | フロントエンドユニット/コンポーネントテスト + バックエンドRustテスト |

<a id="jp-システム要件"></a>

### システム要件

- **OS**: Windows 10 (1809+) / Windows 11
- **ランタイム**: [WebView2 Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/)（Windows 11には内蔵）
- **ディスク容量**: 約100 MB（Modリソースを除く）

<a id="jp-インストール"></a>

### インストール

1. [Releases](../../releases) から最新の `.exe` インストーラーをダウンロード
2. インストーラーを実行し、言語とディレクトリを選択
3. インストール完了後、TrayBuddyを起動するとキャラクターがデスクトップに表示されます
4. システムトレイアイコンを右クリックして設定と機能メニューにアクセス

#### Modのインストール

- **`.tbuddy` または `.sbuddy` ファイルをダブルクリック**で自動インポート（ファイル関連付け済み）
- またはModマネージャーから手動でブラウズしてインポート

<a id="jp-ソースからビルド"></a>

### ソースからビルド

#### 環境準備

ワンクリック環境セットアップスクリプトを実行（管理者権限が必要）：

```bash
setup-windows-build-env.bat
```

このスクリプトは以下を自動インストールします：
- Node.js LTS
- Rust（rustup経由）
- Visual Studio 2022 Build Tools（C++ワークロード）
- NSIS
- WebView2 Runtime

または手動でインストール：

| 依存関係 | 最低バージョン |
|---------|-------------|
| [Node.js](https://nodejs.org/) | 18+ |
| [Rust](https://rustup.rs/) | 1.75+ |
| [pnpm](https://pnpm.io/) | 8+ |
| [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) | 2022 |

#### 開発モード

```bash
# フロントエンド依存関係をインストール
pnpm install

# 開発モードで起動（ホットリロード付き）
dev.bat
# または手動で
pnpm tauri dev
```

#### リリースビルド

```bash
release.bat
```

このスクリプトは以下を実行します：
1. リリースmodsディレクトリをクリーン
2. `pack-mods.ps1` を使用してModを `.tbuddy` 形式にパック
3. `.sbuddy` 形式に暗号化パック（該当する場合）
4. `pnpm tauri build` を実行してNSISインストーラーを生成

ビルド出力先: `src-tauri/target/release/bundle/nsis/`

<a id="jp-modシステム"></a>

### Modシステム

#### Modディレクトリ構成

```
mods/<mod_id>/
├── manifest.json          # コア設定：状態機械、トリガー、キャラクター設定（必須）
├── preview.webp           # プレビュー画像
├── icon.ico               # トレイアイコン
├── bubble_style.json      # 吹き出しスタイルカスタマイズ（オプション）
├── asset/                 # アニメーションリソース
│   ├── img.json           # シーケンスフレーム設定
│   ├── live2d.json        # Live2D設定
│   ├── pngremix.json      # PngRemix設定
│   ├── 3d.json            # 3Dモデル設定
│   └── <リソースファイル...>
├── audio/<lang>/          # 多言語音声
└── text/<lang>/           # 多言語テキスト
    ├── info.json          # 情報テキスト
    └── speech.json        # 対話テキスト
```

#### manifest.json コアコンセプト

```jsonc
{
  "mod_id": "my-mod",
  "mod_type": "sequence",          // sequence | live2d | pngremix | 3d
  "important_states": {            // 組み込み重要状態
    "idle": { ... },               // 待機
    "silence": { ... },            // 沈黙
    "music": { ... },              // 音楽再生中
    "dragging": { ... }            // ドラッグ中
  },
  "states": {                      // カスタム状態
    "greeting": {
      "priority": 5,
      "trigger_time": 60,          // タイマートリガー（秒）
      "branch": [...]              // 分岐ダイアログオプション
    }
  },
  "triggers": {                    // イベント→状態マッピング
    "click": [{ "state": "greeting", "weight": 1 }],
    "music_start": [{ "state": "music" }],
    "keydown:F1": [{ "state": "help" }]
  }
}
```

#### Modパッケージ形式

| 形式 | 拡張子 | 説明 |
|------|--------|------|
| tbuddy | `.tbuddy` | ZIPアーカイブ、ダブルクリックで自動インポート |
| sbuddy | `.sbuddy` | 暗号化アーカイブ（`SBUDDY01` ヘッダー）、Modリソースを保護 |

システムは `tbuddy-asset://` カスタムプロトコルを通じてメモリ内のアーカイブからリソースをストリーミング — ディスクへの展開は不要。

> 詳細なMod開発ガイドは `mods/mod-guide.md` をご参照ください

<a id="jp-ツールチェーン"></a>

### ツールチェーン

TrayBuddyは完全なMod制作ツールチェーンを提供します：

#### Modエディター (`mod-tool/`)

Mod設定をビジュアル編集するスタンドアロンWebアプリ：
- 状態機械エディター
- トリガー設定
- Modテンプレート生成
- 内蔵チュートリアル
- 3言語インターフェース対応

```bash
# Modエディターを起動
cd mod-tool && 打開-mod編輯器.bat
```

#### 補助ツールセット (`other-tool/`)

Mod制作の全ワークフローをカバーする13の独立Webツール：

| ツール | 機能 |
|--------|------|
| GIFフレーム抽出 | GIF動画からフレームシーケンスを抽出 |
| ビデオフレーム抽出 | ビデオファイルからフレームを抽出 |
| スプライトシート生成 | フレームシーケンスをスプライトシートに合成 |
| スプライトシート分割 | スプライトシートを個別フレームに分割 |
| スプライトシート圧縮 | スプライトシートのサイズ最適化 |
| シーケンスプレビュー | シーケンスフレームアニメーションのプレビュー |
| シーケンス位置合わせ | フレームの位置合わせとオフセット調整 |
| 一括クロップ＆リサイズ | バッチ画像処理 |
| PNG → ICO | アイコン形式変換 |
| Live2Dエクスポート | Live2Dモデルのエクスポートと設定 |
| PngRemixプレビュー | PngRemixモデルのプレビューとデバッグ |
| モデルプレビュー | 3D VRM/PMXモデルプレビュー |

#### チェックツール (`check-tool/`)

| ツール | 機能 |
|--------|------|
| Bundle Analyzer | インストールパッケージサイズ分析 |
| Memory Profiler | ランタイムメモリサンプリング分析 |

<a id="jp-プロジェクト構成"></a>

### プロジェクト構成

```
TrayBuddy/
├── src/                        # フロントエンドソース（SvelteKit + TypeScript）
│   ├── routes/                 # ページルーティング（11ページ）
│   │   ├── +page.svelte        #   デバッグメインページ（9タブ）
│   │   ├── animation/          #   スプライトレンダリングウィンドウ
│   │   ├── live2d/             #   Live2Dレンダリングウィンドウ
│   │   ├── pngremix/           #   PngRemixレンダリングウィンドウ
│   │   ├── threed/             #   3Dレンダリングウィンドウ
│   │   ├── mods/               #   Modマネージャー
│   │   ├── settings/           #   ユーザー設定
│   │   ├── memo/               #   メモ
│   │   └── reminder/           #   タイマーリマインダー
│   ├── lib/                    # フロントエンドコアモジュール
│   │   ├── animation/          #   アニメーションプレイヤー（4形式）+ ウィンドウコア
│   │   ├── audio/              #   オーディオ管理
│   │   ├── bubble/             #   吹き出しシステム
│   │   ├── trigger/            #   フロントエンドトリガー
│   │   ├── i18n/               #   国際化
│   │   ├── types/              #   型定義
│   │   ├── utils/              #   ユーティリティ関数
│   │   └── components/         #   デバッグパネルコンポーネント
│   └── test/                   # フロントエンドテスト
├── src-tauri/                  # バックエンドソース（Rust / Tauri 2）
│   └── src/
│       ├── lib.rs              #   アプリエントリ、コマンド登録、カスタムプロトコル
│       ├── app_state.rs        #   グローバル状態管理
│       ├── modules/            #   コア機能モジュール
│       │   ├── resource.rs     #     Modリソース管理
│       │   ├── state.rs        #     状態機械エンジン
│       │   ├── media_observer  #     メディア再生監視
│       │   ├── process_observer#     プロセス検出
│       │   ├── system_observer #     システムイベント監視
│       │   ├── environment.rs  #     環境情報（天気/位置）
│       │   ├── trigger.rs      #     イベントトリガー処理
│       │   ├── storage.rs      #     永続化ストレージ
│       │   ├── mod_archive.rs  #     Modパッケージリーダー
│       │   └── utils/          #     ユーティリティ関数
│       └── commands/           #   Tauriコマンド（フロントエンド-バックエンド通信）
├── config/                     # ランタイム設定（メディア/プロセスキーワード）
├── i18n/                       # 国際化リソース
├── mods/                       # Modディレクトリ（チュートリアルMod含む）
├── mod-tool/                   # Modエディター
├── other-tool/                 # 補助ツールセット（13個）
├── tools-common/               # ツール共有コード
├── check-tool/                 # チェックツール
├── docs/                       # 設計ドキュメント
└── workflows/                  # ComfyUIワークフロー
```

<a id="jp-国際化"></a>

### 国際化

3言語に対応し、アプリケーションの全ての表示テキストをカバー：

| 言語 | ファイル | カバー範囲 |
|------|---------|-----------|
| 簡体字中国語 | `i18n/zh.json` | UI、メニュー、デバッグパネル、設定、NSISインストーラー |
| English | `i18n/en.json` | 同上 |
| 日本語 | `i18n/jp.json` | 同上 |

全てのツール（Modエディター、補助ツールセット）も3言語切替に対応。

<a id="jp-開発ガイド"></a>

### 開発ガイド

#### 日常開発

```bash
# 依存関係をインストール
pnpm install

# 開発モード（ホットリロード）
pnpm tauri dev

# フロントエンドのみ
pnpm dev

# 型チェック
pnpm check
```

#### カスタム設定

インストール後、以下の設定ファイルを変更して動作をカスタマイズできます：

| 設定ファイル | 説明 |
|-------------|------|
| `config/media_observer_keywords.json` | メディアアプリプロセス名キーワード（Spotify、QQ Music、NetEase Cloud等） |
| `config/process_observer_keywords.json` | 作業アプリプロセス名キーワード（VS Code、Photoshop、Unity等） |

<a id="jp-テスト"></a>

### テスト

```bash
# 全フロントエンドテストを実行
pnpm test:run

# フロントエンドテスト（ウォッチモード）
pnpm test:watch

# フロントエンドテストカバレッジ
pnpm test:coverage

# バックエンドRustテストを実行
cd src-tauri && cargo test

# ワンクリック全テスト（フロントエンド + バックエンド + カバレッジ）
test.bat
```

<a id="jp-ライセンス"></a>

### ライセンス

本プロジェクトは [MIT License](LICENSE) の下でライセンスされています。

<p align="right"><a href="#日本語">⬆ 日本語トップへ戻る</a></p>

---

<p align="center">
  Made with ❤️ by <a href="https://github.com/cafel">cafel</a>
</p>
