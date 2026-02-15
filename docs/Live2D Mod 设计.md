# Live2D Mod 设计

## 背景与目标
- 在现有序列帧 Mod 体系基础上新增 **Live2D Mod** 类型。
- 除动画资源与动画配置外，其它结构与逻辑应与序列帧 Mod 完全一致。
- 资源统一由 `ResourceManager` 管理，`mods` 窗口统一切换。

> 说明：本设计参考了既有项目结构与动画链路；如需与 `mao_pro_zh` 目录完全一致，请提供其目录树或配置片段以进一步对齐字段。

---

## Mod 类型标识（Manifest）
在 `manifest.json` 内新增字段：
- `mod_type`: `sequence` | `live2d`

约束：
- **在 mod-tool 新建时选择类型，创建后不可修改**。

---

## Live2D 动画配置结构（建议）
新增文件：`asset/live2d.json`

### 示例结构
```json
{
  "schema_version": 1,
  "model": {
    "name": "mao",
    "base_dir": "asset/live2d/mao_pro_zh",
    "model_json": "mao_pro_zh.model3.json",
    "textures_dir": "textures",
    "motions_dir": "motions",
    "expressions_dir": "expressions",
    "physics_json": "physics3.json",
    "pose_json": "pose3.json",
    "breath_json": "breath.json",
    "eye_blink": true,
    "lip_sync": true
  },
  "motions": [
    {
      "name": "idle_1",
      "file": "motions/idle_01.motion3.json",
      "group": "Idle",
      "priority": "Idle",
      "fade_in_ms": 200,
      "fade_out_ms": 200,
      "loop": true
    }
  ],
  "expressions": [
    {
      "name": "happy",
      "file": "expressions/happy.exp3.json"
    }
  ],
  "states": [
    {
      "state": "idle",
      "motion": "idle_1",
      "expression": "happy",
      "scale": 1.0,
      "offset_x": 0,
      "offset_y": 0
    }
  ]
}
```

### 字段说明
- `model.base_dir`：模型资源根目录，通常对应 `asset/live2d/<model>`。
- `model.model_json`：主模型配置（`model3.json`）。
- `motions`：动作资源列表（含 `group/priority/loop`）。
- `states`：状态与动作映射，便于和现有“状态机 → 资源”逻辑对齐。

---

## mod-tool 设计
- 新建 Mod 时弹出类型选择：
  - `sequence`（序列帧）
  - `live2d`（Live2D）
- 选择后：
  - 写入 `manifest.mod_type`
  - 生成对应模板（`template/sequence/*` 或 `template/live2d/*`）
- 编辑动画配置页面根据 `mod_type` 切换 UI：
  - `sequence` → 当前序列帧编辑器
  - `live2d` → Live2D 动作、表情、状态编辑器

---

## 后端 Resource 结构设计
- `ResourceManager` 统一管理所有 Mod。
- 按 `mod_type` 分支解析动画配置：
  - `sequence` → `asset/sequence.json` + `asset/img.json`
  - `live2d` → `asset/live2d.json`

建议结构：
- `ModInfo { mod_type, assets: ModAssets }`
- `ModAssets`：
  - `SequenceAssets`
  - `Live2DAssets`

---

## Resource Debugger
- 根据当前加载 Mod 的 `mod_type`：
  - `sequence`：显示 `sequence.json` 与 `img.json`
  - `live2d`：显示 `live2d.json`（`model/motions/expressions/states`）

---

## 前端窗口与播放逻辑
- 新增 `Live2D Window`，只处理 Live2D 播放。
- 现有 `Animation Window` 继续处理序列帧播放。
- 加载 Mod 时：
  - `sequence` → 打开 `animation window`
  - `live2d` → 打开 `live2d window`

---

## 共享逻辑抽离
从当前 `animation window` 中抽取通用逻辑，供两个窗口复用：
- 通用逻辑：状态监听、触发器、文本/气泡、音频、`on_animation_complete`、`mod_data` 等。
- 播放逻辑：
  - `SequencePlayer`（序列帧）
  - `Live2DPlayer`（Live2D）

---

## 待确认信息
如需完全对齐 `mao_pro_zh` 的结构，请提供：
- 目录树
- `*.model3.json` 或 `motions/expressions` 示例片段

---

## 预期落地范围
- `manifest.json` 新增 `mod_type`
- `mod-tool` 创建流程增加类型选择
- `ResourceManager` 增加 Live2D 资产解析
- `Resource Debugger` 支持 Live2D 资产展示
- 前端新增 `Live2D Window`
- 前端通用逻辑抽离
