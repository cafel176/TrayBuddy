# 3D Mod 设计

## 背景与目标

在现有 **序列帧 / Live2D / PngRemix** 的 Mod 体系上，新增一种 **3D Mod** 类型，用于加载 3D 模型并播放动画。

核心目标：

- **与现有 Mod 体系一致**：资源统一由 `ResourceManager` 管理，`mods` 窗口统一切换；状态机、触发器、文本/气泡、音频、`mod_data` 等通用链路复用现有实现。
- **支持扫描 mod 目录**：3D Mod 能扫描 `mods/<mod_id>/`（或 `.tbuddy` archive 内的目录树），识别：
  - 模型：`.vrm` / `.pmx`
  - 动画：`.vrma` / `.vmd`
- **像 Live2D 一样接入“状态 → 动画”**：通过程序状态切换来播放对应动画；并能在运行时选择/切换到某个动画文件播放。

> 本设计将直接复用仓库内的 3D 播放原型：`other-tool/模型预览`。
> 该原型基于 `three.js`、`three-vrm`、`MMDLoader`，已覆盖：
> - VRM + VRMA（`VRMC_vrm_animation`）加载与重定向（bake 成 `AnimationClip`）
> - PMX + VMD 加载

---

## Mod 类型标识（Manifest）

在 `manifest.json` 的 `mod_type` 扩展新值：

- `mod_type`: `sequence` | `live2d` | `pngremix` | `3d`

约束：

- **在 mod-tool 新建时选择类型，创建后不可修改**（与 Live2D/PngRemix 一致）。

Rust 端建议：

- 在 `ModType` 枚举中新增变体，并显式 `serde rename`：
  - `ThreeD`（或 `Mod3D`），并标注 `#[serde(rename = "3d")]`，避免 `rename_all = "lowercase"` 无法生成 `"3d"` 的问题。

---

## 3D 资源组织与扫描策略

### 推荐的 Mod 目录结构（建议）

尽管系统支持扫描整个 Mod 目录，为了可维护与可迁移，推荐用户按如下方式组织：

```text
My3DMod/
├── manifest.json                 # mod_type: "3d"
├── asset/
│   ├── 3d.json                   # 3D 总配置（可选；存在时优先生效）
│   └── 3d/
│       ├── model.vrm             # 或 model.pmx
│       ├── textures/             # PMX 贴图建议放这里（也可与模型同级）
│       └── anims/
│           ├── idle_1.vrma       # VRM 动画示例
│           ├── idle_2.vrma
│           └── wave_1.vmd        # PMX 动画示例
├── text/
│   └── zh/
│       ├── info.json
│       └── speech.json
└── audio/
    └── zh/
        └── morning.wav
```

### 扫描规则（当 `asset/3d.json` 不存在时）

当 `asset/3d.json` 缺失时，`ResourceManager` 需要通过扫描结果构建“可用模型/动画清单”，并生成默认播放映射：

- 扫描范围：
  - 文件夹 mod：遍历 `mods/<mod_id>/` 下所有文件（可对 `node_modules` 等无关目录做忽略；若 mod 体量大可仅遍历 `asset/` 优先，再回退全目录）。
  - archive mod：遍历 archive 内路径表（与当前 `read_mod_from_archive` 体系一致）。

- 识别与归类：
  - **模型候选**：所有 `.vrm`、`.pmx`
  - **动画候选**：所有 `.vrma`、`.vmd`

- 选择“主模型”的优先级（可配置化）：
  1. 如果 `asset/3d/model.vrm` 或 `asset/3d/model.pmx` 存在，优先选它。
  2. 否则按文件名包含 `model`、`main` 等关键词排序。
  3. 仍不唯一则选择路径最短/字典序最小的一个。

- 选择“默认动画”的优先级：
  1. 文件名包含 `idle` 优先。
  2. 否则选择字典序最小。
  3. 若无动画文件，则允许“仅模型静止显示”。

- 自动生成默认映射：
  - 默认创建一个状态映射：`state = idle` → `animation = <默认动画>`（如有）。

> 说明：扫描得到的清单既用于“自动可用”，也用于 mod-tool 的可视化选择（用户可以在 UI 中选择主模型、为动画命名、设置 loop/speed 等）。

---

## 3D 动画配置结构（建议）

新增配置文件：`asset/3d.json`。

设计原则：尽量对齐 `live2d.json` / `pngremix.json` 的思想：

- `model`：模型信息
- `animations`：动画文件列表（可命名、可配置 loop/speed/fps 等）
- `states`：状态名 → 动画名映射（与现有 `StateInfo.anima` 对齐）

### 示例结构（VRM + VRMA）

```json
{
  "schema_version": 1,
  "model": {
    "name": "HatsuneMikuNT",
    "type": "vrm",
    "file": "asset/3d/HatsuneMikuNT.vrm",
    "scale": 1.0,
    "offset_x": 0,
    "offset_y": 0
  },
  "animations": [
    {
      "name": "idle_1",
      "type": "vrma",
      "file": "asset/3d/PET_IDLE 1.vrma",
      "loop": true,
      "speed": 1.0,
      "vrma_fps": 30
    }
  ],
  "states": [
    {
      "state": "idle",
      "animation": "idle_1",
      "scale": 1.0,
      "offset_x": 0,
      "offset_y": 0
    }
  ]
}
```

### 示例结构（PMX + VMD）

```json
{
  "schema_version": 1,
  "model": {
    "name": "Sagiri",
    "type": "pmx",
    "file": "asset/3d/pmx/Sagiri's T-Shirt.pmx",
    "scale": 1.0,
    "offset_x": 0,
    "offset_y": 0,
    "texture_base_dir": "asset/3d/pmx/"
  },
  "animations": [
    {
      "name": "motion_1",
      "type": "vmd",
      "file": "asset/3d/pmx/1.vmd",
      "loop": true,
      "speed": 1.0
    }
  ],
  "states": [
    {
      "state": "idle",
      "animation": "motion_1",
      "scale": 1.0,
      "offset_x": 0,
      "offset_y": 0
    }
  ]
}
```

### 字段说明（建议）

- `model.type`：`"vrm" | "pmx"`
- `model.file`：相对 mod 根目录的路径
- `model.texture_base_dir`：PMX 可选，用于贴图加载（若贴图路径相对模型文件，可省略）
- `animations[].name`：动画的逻辑名称（供状态映射与 UI 选择）
- `animations[].type`：`"vrma" | "vmd"`
- `animations[].file`：动画文件路径
- `animations[].loop`：是否循环
- `animations[].speed`：播放倍速（最终映射到 `AnimationMixer.timeScale` 或 MMD helper 速度）
- `animations[].vrma_fps`：仅 VRMA 使用，bake 采样 FPS（默认 30；提高会更平滑但更耗时）

---

## 后端 Resource 结构设计（Rust）

### 数据结构

参考 Live2D/PngRemix 的做法，在 `src-tauri/src/modules/resource.rs` 中新增：

- `ThreeDModelConfig`
- `ThreeDAnimation`
- `ThreeDState`
- `ThreeDConfig`

并在 `ModInfo` 结构中新增：

- `threed: Option<ThreeDConfig>`（字段名可用 `three_d` / `threed`，序列化为 `threed` 或 `three_d` 均可，建议与既有风格一致）

### 加载逻辑

在 `ResourceManager::rebuild_mod_index`（以及 archive 对应读取逻辑）中按 `mod_type` 分支：

- `sequence`：现有 `asset/sequence.json` / `asset/img.json`
- `live2d`：现有 `asset/live2d.json`
- `pngremix`：现有 `asset/pngremix.json`
- `3d`：新增 `asset/3d.json`（可选）
  - 若存在：按 schema 解析
  - 若不存在：执行扫描逻辑，生成一个“运行时默认 3D 配置”（仅用于运行；mod-tool 可一键生成落盘版本）

> 说明：运行时默认配置建议也返回给前端（方便 UI 展示“系统识别结果”）。

---

## 前端类型定义（TypeScript）

在 `src/lib/types/asset.ts`：

- 扩展 `ModType`：加入 `"3d"`
- 新增与 Rust 对齐的 3D 配置接口（`ThreeDConfig` 等）

并在 `Resource Debugger` 中新增 3D 配置展示（类似 Live2D/PngRemix）。

---

## 前端窗口与播放逻辑

### 新增 3D Window

参考现有 `live2d` / `pngremix` 分窗策略：

- 新增窗口路由：`src/routes/3d/+page.svelte`（或 `src/routes/threed/+page.svelte`）
- 后端新增窗口 label：`WINDOW_LABEL_3D`
- 加载 Mod 时按 `mod_type` 分流：
  - `sequence` → animation window
  - `live2d` → live2d window
  - `pngremix` → pngremix window
  - `3d` → 3d window

### 3DPlayer（渲染引擎）

新增 `src/lib/animation/ThreeDPlayer.ts`，职责对齐 `Live2DPlayer` / `PngRemixPlayer`：

- 初始化 three.js 渲染器、相机、灯光、OrbitControls（可选：正式窗口默认禁用 Orbit，仅用于调试）
- 加载模型
- 加载/构建动画 clip
- 播放/暂停/切换动画
- 对接 `WindowCore`：
  - 接收状态切换 → `playFromAnima(stateName)`
  - 触发 `on_animation_complete`（非 loop 动画播放完时）

### VRM 播放策略（VRM + VRMA）

复用 `other-tool/模型预览/app.js` 中已经验证过的思路：

- 模型：`GLTFLoader + VRMLoaderPlugin` 加载 `.vrm`
- 动画：`GLTFLoader` 加载 `.vrma`（glTF）
- 重定向：读取 VRMA glTF 中的 `VRMC_vrm_animation` 扩展，按 humanoid bone 映射把源动画 bake 成针对当前 VRM 骨骼节点的 `AnimationClip`
- 播放：`THREE.AnimationMixer` + `AnimationAction`
- 帧更新：每帧 `mixer.update(dt)`，并调用 `vrm.update(dt)`（确保 VRM 内部约束/弹簧/表情更新）

性能建议：

- VRMA bake 可能较慢，建议：
  - 首次加载时 bake 并缓存（按 `mod_id + animation_path + model_path + fps` 作为 key）
  - 可把 bake 放到 WebWorker（若后续要优化）

### PMX 播放策略（PMX + VMD）

基于 three.js 示例中的 `MMDLoader`：

- 模型：`MMDLoader.load()` 加载 `.pmx`
- 动画：`MMDLoader.loadAnimation()` 加载 `.vmd`（可支持单个或多个 vmd 合并）
- 贴图：需要支持模型文件请求的贴图路径解析
  - 对 **folder mod**：需要一个“保留路径层级”的 asset URL（类似 `buildModAssetUrlForLive2D`）
  - 对 **archive mod**：现有 `tbuddy-asset://` URL 天然有层级结构
  - 使用 `THREE.DefaultLoadingManager.setURLModifier((url) => ...)` 将贴图相对路径重写到正确的 mod 资源 URL

> 说明：MMD 的物理/IK/表情等若需要，可后续引入 `MMDAnimationHelper`。P0 阶段可只做“能播 VMD”。

---

## 资源 URL 与加载兼容（关键）

当前工程对 folder mod 资源用 `convertFileSrc()`，该函数会把路径中的 `/` 编码成 `%2F`，这会破坏三方库基于“目录层级”的相对路径解析。

Live2D 已经专门提供了 `buildModAssetUrlForLive2D()`，其策略为：

- folder mod：`convertFileSrc(fullPath)` 后，将 `%2F`/`%3A` 还原，保留 URL 层级
- archive mod：直接使用 `tbuddy-asset` 方案

3D Mod 需要同样的能力，建议新增：

- `buildModAssetUrlFor3D(modPath, relativePath)`

并用于：

- VRM 的二进制加载
- VRMA 的 glTF 加载
- PMX 的贴图/依赖文件重写

---

## 与状态机 / 触发器体系的融合方式

### 状态到动画的映射

沿用现有模式：

- `StateInfo.anima` 表示“该状态要播放的动画名称”
- 3D Mod 通过 `asset/3d.json` 的 `states[]` 把 `state` 映射到 `animation`（动画名）

流程：

1. 状态机切换到某个状态 `S`
2. `WindowCore` 调用 `player.playFromAnima(S.anima)`
3. `ThreeDPlayer` 根据 `3d.json.states` 查找 `state == anima`（或 `state == StateInfo.name`，按你当前项目约定）
4. 找到 `animation` 后执行 `playAnimationByName(animationName)`

> 推荐对齐 Live2D/PngRemix：使用 `states[].state` 与 `StateInfo.anima` 对接（即 `anima` 存的是逻辑 state 名）。

### 动画播放完成事件

- 对于 `loop = false` 的动画：
  - VRM：`AnimationAction` 可检测 `finished`（监听 mixer 的 `finished` 事件）
  - PMX：可从 clip.duration 推断结束（或使用 helper 的事件）
- 完成时：触发现有 `on_animation_complete` 链路，允许状态机自动跳转或触发分支。

---

## mod-tool 设计（3D）

参考 Live2D/PngRemix 的思路，3D Mod 的 mod-tool 需要解决两件事：

1. **资产识别**（扫描/导入）：让用户把 VRM/PMX/VRMA/VMD 放到 mod 中，工具能识别并建立清单。
2. **映射编辑**（配置）：给动画命名、设置 loop/speed，建立 `states` 映射。

建议 UI：

- 新建 Mod 时：类型选择增加 `3d`
- `3D` 编辑页：
  - **模型区**：
    - 模型类型（自动识别 / 手动选择：VRM 或 PMX）
    - 模型文件选择（从扫描清单里选择）
    - scale/offset
  - **动画区**：
    - 列出扫描到的 `vrma/vmd` 文件
    - 支持“重命名为动画名”（默认取文件名去后缀）
    - loop/speed
    - VRMA 专有：bake fps
  - **状态映射区**：
    - `state` → `animation` 下拉选择
    - scale/offset 覆写
  - **预览区（可选但强烈建议）**：
    - 直接复用 `other-tool/模型预览` 的渲染逻辑（迁移为可复用组件），实现所见即所得

输出：

- 保存 `asset/3d.json`
- 可一键整理文件到推荐目录结构（仅提示或可选自动移动/复制）

---

## Resource Debugger（3D）

根据当前加载 Mod 的 `mod_type`：

- `sequence`：显示 `sequence.json`/`img.json`
- `live2d`：显示 `live2d.json`
- `pngremix`：显示 `pngremix.json`
- `3d`：显示：
  - `asset/3d.json`（若有）
  - 扫描识别结果（模型候选、动画候选、最终选择的主模型/默认动画）
  - VRMA bake 缓存命中情况（若实现缓存）

---

## 版本与落地优先级建议

- **P0（可用）**：
  - `mod_type = 3d` 打通
  - VRM + VRMA / PMX + VMD 基础加载与播放
  - 状态切换能切动画
- **P1（可用 + 可配置）**：
  - `asset/3d.json` + mod-tool 编辑
  - Resource Debugger 支持 3D
- **P2（体验/性能）**：
  - VRMA bake 缓存与 Worker
  - PMX 贴图/依赖路径鲁棒性增强
  - 视角/骨骼调试工具

---

## 基于本仓库样例文件的验证用例

你提供的本地样例可直接作为 P0 验证集：

- VRM 模型：`other-tool/模型预览/HatsuneMikuNT.vrm`
- VRMA 动画：`other-tool/模型预览/PET_IDLE 1.vrma`
- PMX 模型：`other-tool/模型预览/pmx/Sagiri's T-Shirt.pmx`
- VMD 动画：`other-tool/模型预览/pmx/1.vmd`

建议在实现 3D Mod 后，把上述文件复制到一个测试 mod 目录（如 `mods_test/` 下新建）并验证：

1. 扫描能识别模型与动画
2. UI 能选择主模型与动画
3. 状态切换触发动画播放
4. 关闭/切换 mod 后资源正确释放（避免 WebGL/纹理泄漏）
