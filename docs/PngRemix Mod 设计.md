# PngRemix Mod 设计

## 背景与目标

- 在现有序列帧 / Live2D Mod 体系基础上新增 **PngRemix Mod** 类型。
- 除动画资源与动画配置外，其它结构与逻辑应与 Live2D Mod 完全一致（状态机、触发器、文本/气泡、音频、`mod_data` 等复用现有链路）。
- 资源统一由 `ResourceManager` 管理，`mods` 窗口统一切换。
- PngRemix 的渲染引擎在前端使用 Canvas2D 实现，移植自现有的 `other-tool/pngRemix预览` 工具。

### PngRemix 格式说明

`.pngRemix` 是 PNGTuber Remix（Godot 4 应用）的存档格式，内部是 Godot 4 `FileAccess.store_var(data, true)` 输出的二进制序列化数据。

#### 顶层字典结构（v1.4.1 最新）

| Key | 类型 | 说明 |
|-----|------|------|
| `version` | String | 应用版本号（如 `"1.4.1"`），加载时用于版本检测与自动转换（`VersionConverter.convert_save()`） |
| `sprites_array` | Array\<Dictionary\> | 所有精灵对象数据（层叠顺序） |
| `settings_dict` | Dictionary | 全局设置 |
| `input_array` | Array\<Dictionary\> | **v1.4.1 新增**：State 按钮的热键绑定，每条 `{ state_name: String, hot_key: InputEvent }` |
| `image_manager_data` | Array\<Dictionary\> | **新版格式**：独立的图片资源池，精灵通过 `image_id` / `normal_id` 引用 |

> **旧版兼容**：早期版本无 `image_manager_data`，图片内嵌在每个 sprite 的 `img` / `normal` 字段中。加载时需兼容两种方式。同理，早期版本无 `input_array`，快捷键信息存储在每个 sprite 的 `saved_keys`（字符串数组）中。

#### `settings_dict` — 全局设置字典

| Key | 类型 | 默认值 | 说明 |
|-----|------|--------|------|
| `sensitivity_limit` | float | 1 | 麦克风灵敏度 |
| `volume_limit` | float | 0.1 | 音量阈值 |
| `volume_delay` | float | 0.5 | 音量延迟 |
| `blink_speed` | float | 1 | 眨眼速度 |
| `blink_chance` | float | 10 | 眨眼概率（1/N） |
| `checkinput` | bool | true | 检查输入 |
| `bg_color` | Color | SLATE_GRAY | 背景颜色 |
| `is_transparent` | bool | false | 背景是否透明 |
| `states` | Array\<Dictionary\> | `[{}]` | SpritesContainer 状态数组（嘴巴动画/弹跳/物理/效果参数） |
| `light_states` | Array\<Dictionary\> | `[{}]` | 灯光状态数组 |
| `darken` | bool | false | 说话时暗化 |
| `anti_alias` | bool | true | 抗锯齿 |
| `dim_color` | Color | DIM_GRAY | 暗化颜色 |
| `auto_save` | bool | false | 自动保存 |
| `auto_save_timer` | float | 1.0 | 自动保存间隔（分钟） |
| `saved_inputs` | Array | `[]` | 保存的输入 |
| `zoom` | Vector2 | (1,1) | 缩放 |
| `pan` | Vector2 | (0,0) | 平移 |
| `should_delta` | bool | true | 是否使用 delta 时间 |
| `max_fps` | int | 60 | 最大帧率 |
| `monitor` | int | ALL_SCREENS | 监视器 |
| `snap_out_of_bounds` | bool | true | 超出边界吸附 |
| `cycles` | Array | `[]` | 循环组 |
| `language` | String | `"automatic"` | 语言 |
| `preferred_language` | String\|null | null | 首选语言 |
| `trimmed` | bool | false | 是否已裁剪 |

##### `settings_dict.states[i]` — 每个状态的容器级参数

| Key | 类型 | 说明 |
|-----|------|------|
| `mouth_closed` / `mouth_open` | int | 嘴巴关闭/张开动画类型 |
| `current_mc_anim` / `current_mo_anim` | String | 动画名（`"Idle"` / `"Bouncy"` / `"Wobble"` / `"Squish"` / `"Float"`） |
| `should_squish` | bool | 挤压动画 |
| `squish_amount` | float | 挤压量 |
| `bounce_state` | bool | 弹跳开关 |
| `state_param_mc` / `state_param_mo` | Dictionary | 物理参数（`bounce_gravity`, `bounce_energy`, `xFrq`, `xAmp`, `yFrq`, `yAmp`） |
| `model_effects` | Dictionary | 模型效果（`color_blindness_effect`, `effect_type/size/color`, `roll_speed/size`, `aberration`） |
| `dim_color` | Color | 暗化颜色 |

#### `image_manager_data[i]` — 图片资源数据（新版格式）

| Key | 类型 | 说明 |
|-----|------|------|
| `id` | int | 唯一 ID（`randi()` 生成） |
| `image_name` | String | 图像名称 |
| `runtime_texture` | PackedByteArray | PNG 格式图像缓冲 |
| `anim_texture` | PackedByteArray\|null | GIF/APNG 动画原始数据 |
| `img_animated` | bool | 是否为 GIF 动画 |
| `is_apng` | bool | 是否为 APNG |
| `image_data` | PackedByteArray\|Array\|null | 原始图像数据（裁剪前原图） |
| `trimmed` | bool | 是否已裁剪 |
| `offset` | Vector2 | 裁剪偏移量 |
| `sprite_sheet` | bool | 是否为 sprite sheet |

#### `sprites_array[i]` — 精灵对象结构

**通用字段（所有 sprite_type 共有）：**

| Key | 类型 | 说明 |
|-----|------|------|
| `states` | Array\<Dictionary\> | 每个 State 下的 sprite_data 快照 |
| `sprite_name` | String | 精灵名称 |
| `sprite_id` | float | 精灵唯一 ID |
| `parent_id` | float\|null | 父级 ID |
| `sprite_type` | String | 类型：`"Sprite2D"` / `"WiggleApp"` / `"Mesh"` / `"Comment"` |
| `is_asset` | bool | 是否为可切换资产（hotkey 控制的部件） |
| `saved_event` | InputEvent | 保存的输入事件 |
| `was_active_before` | bool | 之前是否激活 |
| `should_disappear` | bool | 是否应消失 |
| `show_only` | bool | 仅显示 |
| `hold_to_show` | bool | 按住显示 |
| `is_collapsed` | bool | 图层面板是否折叠 |
| `is_premultiplied` | bool | 预乘 alpha（v1.4.1 始终 `true`） |
| `layer_color` | Color | 图层颜色 |
| `image_id` | int | 引用的图像 ID（对应 `image_manager_data[].id`） |
| `normal_id` | int | 引用的法线贴图 ID |
| `rotated` | float | 旋转角度 |
| `flipped_h` / `flipped_v` | bool | 水平/垂直翻转 |
| `rest_mode` | int | 静止模式 |
| `ik_target` | int/float | IK 目标精灵 ID（`-1` 表示无） |
| `updated_follow_movement` | bool | v1.4.1 始终 `true`，标记是否已迁移旧版 follow 参数格式 |

**旧版兼容字段（当无 `image_manager_data` 或旧版本时出现）：**

| Key | 说明 |
|-----|------|
| `img` | 旧版内嵌图像数据（PackedByteArray） |
| `normal` | 旧版法线贴图数据 |
| `is_apng` | 旧版 APNG 标记（新版移入 `image_manager_data`） |
| `img_animated` | 旧版 GIF 标记（新版移入 `image_manager_data`） |
| `saved_keys` | **旧版**按键名字符串数组（如 `["F2","F3"]`），新版改用 `saved_disappear`（InputEvent 数组）+ `input_array` |
| `deformation_3x3` | 旧版 Mesh 变形格式（9 元素数组），新版改用 `deform_layers` |

**Mesh 类型额外字段（`sprite_type == "Mesh"` 时）：**

| Key | 类型 | 说明 |
|-----|------|------|
| `original_vertices` / `base_vertices` / `internal_vertices` | PackedVector2Array | 网格顶点 |
| `warps` | Array | 变形数据 |
| `triangles` | PackedInt32Array | 三角形索引 |
| `deform_layers` | Array\<Dictionary\> | 变形层（含 `top_left/top_middle/.../bottom_right` 各 PackedVector2Array + 物理参数） |

#### `sprites_array[i].states[j]` — 单个 State 下的精灵数据快照

源自 `SpriteObjectClass.gd` 的 `DEFAULT_DATA`，每个 State 是其完整快照：

**鼠标跟随 / 运动参数（Mouth Closed 无前缀，Mouth Open 带 `mo_` 前缀，Screaming 带 `scream_` 前缀）：**

| Key（以无前缀为例） | 类型 | 默认值 | 说明 |
|-----|------|--------|------|
| `shared_movement` | bool | true | 三种嘴巴状态共用运动参数 |
| `editing_for` | int | 0 | 当前编辑的嘴巴状态（0=Closed, 1=Open, 2=Screaming） |
| `xAmp` / `xFrq` | float | 0 | X 轴振幅/频率 |
| `yAmp` / `yFrq` | float | 0 | Y 轴振幅/频率 |
| `dragSpeed` | float | 0 | 拖拽速度 |
| `stretchAmount` | float | 0 | 拉伸量 |
| `rdragStr` | float | 0 | 旋转拖拽强度 |
| `rot_frq` | float | 0 | 旋转频率 |
| `rLimitMin` / `rLimitMax` | float | -180/180 | 旋转限制 |
| `should_rot_speed` | float | 0.01 | 旋转速度 |
| `should_rotate` | bool | false | 是否旋转 |
| `mouse_delay` | float | 0.1 | 鼠标跟随延迟 |
| `look_at_mouse_pos` / `look_at_mouse_pos_y` | float | 0 | **旧版**鼠标跟随位置偏移（新版迁移为 `pos_x_min/max`, `pos_y_min/max`） |
| `mouse_rotation` / `mouse_rotation_max` | float | 0 | **旧版**鼠标旋转（新版迁移为 `rot_min/max`） |
| `mouse_scale_x` / `mouse_scale_y` | float | 0 | **旧版**鼠标缩放（新版迁移为 `scale_x_min/max`, `scale_y_min/max`） |
| `pos_x_min/max`, `pos_y_min/max` | float | 0 | **v1.4.1 新版**位置跟随范围 |
| `rot_min/max` | float | 0 | **v1.4.1 新版**旋转跟随范围 |
| `scale_x_min/max`, `scale_y_min/max` | float | 0 | **v1.4.1 新版**缩放跟随范围 |
| `pos_swap_x/y`, `scale_swap_x/y` | bool | false | 交换轴 |
| `pos_invert_x/y`, `scale_invert_x/y` | bool | false | 反转轴 |
| `drag_snap` | float | 0 | 拖拽吸附 |
| `index_change` / `index_change_y` | int | 0 | 帧索引变化 |

> **旧版 → 新版迁移**：当 `sprite.updated_follow_movement == false` 时，需要执行 `updated_follow_check()` 将旧版 `look_at_mouse_pos`、`mouse_rotation`、`mouse_scale_x/y` 转换为新版 `pos_x_min/max`、`rot_min/max`、`scale_x_min/max` 等字段。这一逻辑在 `model-normalizer.js` 的 `applyLegacyStateFixups()` 中已完整实现。

**显示 / 行为属性：**

| Key | 类型 | 默认值 | 说明 |
|-----|------|--------|------|
| `blend_mode` | String | `"Normal"` | 混合模式 |
| `visible` | bool | true | 可见性 |
| `colored` | Color | WHITE | 颜色 |
| `tint` | Color | WHITE | 着色 |
| `z_index` | int | 0 | Z 排序 |
| `open_eyes` | bool | true | 睁眼（眨眼系统核心标记） |
| `open_mouth` | bool | false | 张嘴 |
| `should_blink` | bool | false | 是否参与眨眼（互斥标记：同 state 下 `should_blink=true` 的层在眨眼时切换 `open_eyes`） |
| `should_talk` | bool | false | 是否说话时变化 |
| `animation_speed` | int | 1 | 动画速度 |
| `hframes` / `vframes` | int | 1 | 水平/垂直帧数（sprite sheet） |
| `scale` | Vector2 | (1,1) | 缩放 |
| `folder` | bool | false | 是否为文件夹节点 |
| `position` | Vector2 | (0,0) | 位置 |
| `rotation` | float | 0 | 旋转 |
| `offset` | Vector2 | (0,0) | 偏移 |
| `ignore_bounce` | bool | false | 忽略弹跳 |
| `clip` | int | 0 | 裁剪模式 |
| `fade` / `fade_asset` | bool | false | 淡入淡出 |
| `fade_speed` / `fade_speed_asset` | float | 1.0 | 淡入速度 |
| `physics` | bool | true | 物理效果 |
| `follow_type` / `follow_type2` / `follow_type3` | int | 15 | 跟随类型（0=Mouse, 15=None；分别控制位置/旋转/缩放） |
| `follow_range` | bool | true | 跟随范围限制 |
| `follow_strength` | float | 0.155 | 跟随强度 |
| `follow_mouse_velocity` | bool | false | 跟随鼠标速度 |
| `snap_pos` / `snap_rot` / `snap_scale` | bool | false | 吸附 |
| `rotation_threshold` | float | 0.01 | 旋转阈值 |
| `static_obj` | bool | false | 静态对象 |
| `hidden_item` | bool | false | 隐藏项 |
| `is_cycle` | bool | false | 是否为循环组 |
| `cycle` | int | 0 | 循环组 ID |
| `pause_movement` | bool | false | 暂停运动 |
| `rainbow` / `rainbow_self` | bool | false | 彩虹效果 |
| `rainbow_speed` | float | 0.01 | 彩虹速度 |
| `follow_eye` / `gaze_eye` / `style_eye` | int | 0 | 眼球追踪 |
| `follow_mouth` | int | 0 | 嘴巴追踪 |
| `udp_pos` / `udp_rot` / `udp_scale` | int | 0 | UDP 追踪 |
| `chain_softness` | float | 5 | 链式软度 |
| `chain_rot_min` / `chain_rot_max` | float | -3.14/3.14 | 链式旋转限制 |
| `mesh_phys_x` / `mesh_phys_y` | float | 75 | 网格物理 |
| `use_object_pos` | bool | true | 使用对象位置 |
| `wiggle` | bool | false | 摆动 |
| `wiggle_amp` / `wiggle_freq` | float | 0 | 摆动振幅/频率 |
| `wiggle_physics` | bool | false | 摆动物理 |
| `wiggle_rot_offset` | Vector2 | (0.5,0.5) | 摆动旋转偏移 |
| `follow_parent_effects` | bool | false | 跟随父级效果 |
| `follow_wa_tip` | bool | false | 跟随 WiggleApp 尖端 |
| `tip_point` | int | 0 | 尖端点 |
| `follow_wa_mini` / `follow_wa_max` | float | -180/180 | 跟随角度范围 |
| `non_animated_sheet` | bool | false | 非动画 sheet |
| `animate_to_mouse` | bool | false | 动画跟随鼠标 |
| `animate_to_mouse_speed` | float | 10 | 动画跟随速度 |
| `animate_to_mouse_track_pos` | bool | true | 追踪位置 |
| `frame` | int | 0 | 当前帧 |
| `advanced_lipsync` | bool | false | 高级口型同步 |
| `should_reset` / `should_reset_state` | bool | false | 重置 |
| `one_shot` | bool | false | 一次性动画 |
| `flip_sprite_h` / `flip_sprite_v` | bool | false | 精灵翻转 |

#### 版本转换系统

PNGTuber Remix 1.4.1 内置 `VersionConverter`（链式转换器模式）：
- 每个 `VersionMapper` 定义 `from_version` → `to_version` + `converter: GDScript`
- 加载时若 `version` 与当前版本不匹配，自动创建备份并依次执行转换链
- 当前仅有 `DummyConverter`（直通，无实际转换），说明 1.4.1 格式与前几个版本兼容，主要差异通过运行时的 `updated_follow_check()` 和 `image_manager_data` 检测来弥合

#### 解码器兼容策略（TrayBuddy 侧）

已有的 `pngremix-decoder.js` 负责 Godot 4 二进制反序列化，`model-normalizer.js` 负责：
1. 检测是否有 `image_manager_data`，有则按 `image_id` 索引图片；无则从 `sprite.img` / `sprite.image_data` 回退读取
2. 检测 `sprite.updated_follow_movement`，为 `false` 时自动执行旧版 follow 参数 → 新版 `pos/rot/scale_min/max` 的迁移
3. 所有 state 字段按 `STATE_DEFAULTS` 补全缺失值，确保渲染时不需再做空值检查

---

## Mod 类型标识（Manifest）

在 `manifest.json` 的 `mod_type` 字段扩展新值：

```
mod_type: "sequence" | "live2d" | "pngremix"
```

约束：
- **在 mod-tool 新建时选择类型，创建后不可修改**。
- pngremix mod 必须在 `asset/` 下包含 `.pngRemix` 文件和 `pngremix.json` 配置文件。

---

## PngRemix 动画配置结构

新增配置文件：`asset/pngremix.json`

### 示例结构

```json
{
  "schema_version": 1,
  "model": {
    "name": "橘雪梨",
    "pngremix_file": "asset/model.pngRemix",
    "default_state_index": 0,
    "max_fps": 60
  },
  "features": {
    "mouse_follow": true,
    "auto_blink": true,
    "click_bounce": true,
    "click_bounce_amp": 50,
    "click_bounce_duration": 0.5,
    "blink_speed": 1.0,
    "blink_chance": 10,
    "blink_hold_ratio": 0.2
  },
  "expressions": [
    {
      "name": "normal",
      "state_index": 0
    },
    {
      "name": "happy",
      "state_index": 1
    },
    {
      "name": "sad",
      "state_index": 2
    }
  ],
  "motions": [
    {
      "name": "wave",
      "hotkey": "F1",
      "description": "挥手"
    },
    {
      "name": "hat_toggle",
      "hotkey": "F2",
      "description": "切换帽子"
    },
    {
      "name": "glasses",
      "hotkey": "F3",
      "description": "切换眼镜"
    }
  ],
  "states": [
    {
      "state": "idle",
      "expression": "normal",
      "motion": "",
      "scale": 1.0,
      "offset_x": 0,
      "offset_y": 0
    },
    {
      "state": "happy",
      "expression": "happy",
      "motion": "",
      "scale": 1.0,
      "offset_x": 0,
      "offset_y": 0
    },
    {
      "state": "wave",
      "expression": "",
      "motion": "wave",
      "scale": 1.0,
      "offset_x": 0,
      "offset_y": 0
    }
  ]
}
```

### 字段说明

#### `model`（模型基础配置）

| 字段 | 类型 | 说明 |
|------|------|------|
| `name` | string | 模型显示名 |
| `pngremix_file` | string | `.pngRemix` 文件相对于 mod 根目录的路径 |
| `default_state_index` | number | 初始时使用的 pngRemix state 索引（默认 0） |
| `max_fps` | number | 渲染帧率上限（默认 60） |

#### `features`（特性开关与参数）

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `mouse_follow` | bool | true | 是否启用鼠标跟随（驱动 follow_type=0 的部件） |
| `auto_blink` | bool | true | 是否启用自动眨眼 |
| `click_bounce` | bool | true | 是否启用点击跳跃 |
| `click_bounce_amp` | number | 50 | 点击跳跃幅度（px） |
| `click_bounce_duration` | number | 0.5 | 点击跳跃时长（秒） |
| `blink_speed` | number | 1.0 | 自动眨眼检查间隔（秒；覆盖 .pngRemix 文件内的 settings_dict.blink_speed） |
| `blink_chance` | number | 10 | 眨眼概率分母（每次检查 1/N 概率触发） |
| `blink_hold_ratio` | number | 0.2 | 闭眼持续占 blink_speed 的比例 |

> 注：`features` 中的值为 **mod 侧默认值**，可被用户全局设置中的对应项覆盖。
> `.pngRemix` 文件内的 `settings_dict` 中的同名字段作为更低优先级的 fallback。

#### `expressions`（表情 = pngRemix State 切换）

| 字段 | 类型 | 说明 |
|------|------|------|
| `name` | string | 表情名称（供程序 state 引用） |
| `state_index` | number | 对应 `.pngRemix` 文件中的 state 索引 |

表情切换的本质是：将 pngRemix 引擎的当前 `stateId` 切换为 `state_index`，从而使所有精灵读取该 state 下的变换参数和显隐状态。

#### `motions`（动作 = pngRemix Hotkey 组件显隐）

| 字段 | 类型 | 说明 |
|------|------|------|
| `name` | string | 动作名称（供程序 state 引用） |
| `hotkey` | string | 对应 `.pngRemix` 文件中的快捷键（F1-F9） |
| `description` | string | 动作描述（用于 mod-tool 展示） |

动作执行的本质是：调用 pngRemix 引擎的 `applyHotkey(scene, hotkey)` 函数，切换对应快捷键绑定的部件显隐。

> 与 Live2D 的 motion 不同，pngRemix 的 "动作" 是一次性切换（toggle），无播放时长概念。motion 执行后部件保持新状态，直到下次切换。

#### `states`（状态映射 — 与 StateInfo 对接）

| 字段 | 类型 | 说明 |
|------|------|------|
| `state` | string | 对应 `StateInfo.anima`（状态机调度的名称） |
| `expression` | string | 进入该状态时切换的表情名（空字符串表示不切换） |
| `motion` | string | 进入该状态时触发的动作名（空字符串表示不触发） |
| `scale` | number | 缩放（默认 1.0） |
| `offset_x` | number | X 偏移 |
| `offset_y` | number | Y 偏移 |

---

## Mod 目录结构

```
MyPngRemixMod/
├── manifest.json              # mod_type: "pngremix"
├── asset/
│   ├── pngremix.json          # PngRemix 动画配置
│   ├── model.pngRemix         # PNGTuber Remix 存档文件
│   ├── img.json               # (可选) 封面/缩略图资产定义
│   └── idle.webp              # (可选) 封面图
├── text/
│   └── zh/
│       ├── info.json          # Mod 信息
│       └── speech.json        # 对话文本
└── audio/
    └── zh/
        └── morning.wav        # 语音文件
```

---

## 后端 Resource 结构设计

### Rust 数据结构

在 `src-tauri/src/modules/resource.rs` 中新增：

```rust
#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ModType {
    Sequence,
    Live2d,
    Pngremix,  // 新增
}
```

```rust
/// PngRemix 模型基础配置
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PngRemixModelConfig {
    pub name: String,
    pub pngremix_file: String,
    #[serde(default)]
    pub default_state_index: u32,
    #[serde(default = "default_60")]
    pub max_fps: u32,
}

/// PngRemix 特性开关与参数
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PngRemixFeatures {
    #[serde(default = "default_true")]
    pub mouse_follow: bool,
    #[serde(default = "default_true")]
    pub auto_blink: bool,
    #[serde(default = "default_true")]
    pub click_bounce: bool,
    #[serde(default = "default_50f")]
    pub click_bounce_amp: f64,
    #[serde(default = "default_05f")]
    pub click_bounce_duration: f64,
    #[serde(default = "default_1f")]
    pub blink_speed: f64,
    #[serde(default = "default_10")]
    pub blink_chance: u32,
    #[serde(default = "default_02f")]
    pub blink_hold_ratio: f64,
}

/// PngRemix 表情（对应 state 切换）
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PngRemixExpression {
    pub name: String,
    pub state_index: u32,
}

/// PngRemix 动作（对应 hotkey 组件显隐）
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PngRemixMotion {
    pub name: String,
    pub hotkey: String,
    #[serde(default)]
    pub description: String,
}

/// PngRemix 状态映射
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PngRemixState {
    pub state: String,
    #[serde(default)]
    pub expression: String,
    #[serde(default)]
    pub motion: String,
    #[serde(default = "default_1f")]
    pub scale: f64,
    #[serde(default)]
    pub offset_x: f64,
    #[serde(default)]
    pub offset_y: f64,
}

/// PngRemix 总配置（asset/pngremix.json）
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PngRemixConfig {
    pub schema_version: u32,
    pub model: PngRemixModelConfig,
    #[serde(default)]
    pub features: PngRemixFeatures,
    #[serde(default)]
    pub expressions: Vec<PngRemixExpression>,
    #[serde(default)]
    pub motions: Vec<PngRemixMotion>,
    #[serde(default)]
    pub states: Vec<PngRemixState>,
}
```

### ModInfo 扩展

在现有 `ModInfo` 的 `live2d: Option<Live2DConfig>` 旁新增：

```rust
pub struct ModInfo {
    pub mod_type: ModType,
    // ... 已有字段 ...
    pub live2d: Option<Live2DConfig>,
    pub pngremix: Option<PngRemixConfig>,  // 新增
}
```

### 加载逻辑

在 `ResourceManager::rebuild_mod_index` 中，按 `mod_type` 分支解析：

```rust
let pngremix = if manifest.mod_type == ModType::Pngremix {
    load_json_obj(&assets_path.join("pngremix.json"))
} else {
    None
};
```

对于 archive mod 同理：

```rust
let pngremix: Option<PngRemixConfig> = if manifest.mod_type == ModType::Pngremix {
    reader.read_json_optional("asset/pngremix.json")
} else {
    None
};
```

---

## 前端类型定义

在 `src/lib/types/asset.ts` 中新增：

```typescript
export type ModType = "sequence" | "live2d" | "pngremix";

export interface PngRemixModelConfig {
  name: string;
  pngremix_file: string;
  default_state_index: number;
  max_fps: number;
}

export interface PngRemixFeatures {
  mouse_follow: boolean;
  auto_blink: boolean;
  click_bounce: boolean;
  click_bounce_amp: number;
  click_bounce_duration: number;
  blink_speed: number;
  blink_chance: number;
  blink_hold_ratio: number;
}

export interface PngRemixExpression {
  name: string;
  state_index: number;
}

export interface PngRemixMotion {
  name: string;
  hotkey: string;
  description: string;
}

export interface PngRemixState {
  state: string;
  expression: string;
  motion: string;
  scale: number;
  offset_x: number;
  offset_y: number;
}

export interface PngRemixConfig {
  schema_version: number;
  model: PngRemixModelConfig;
  features: PngRemixFeatures;
  expressions: PngRemixExpression[];
  motions: PngRemixMotion[];
  states: PngRemixState[];
}
```

---

## 前端窗口与播放逻辑

### PngRemixPlayer

新增 `src/lib/animation/PngRemixPlayer.ts`，职责与 `Live2DPlayer.ts` 对等：

1. **初始化**：
   - 加载 `.pngRemix` 文件（通过 `fetch` 从 asset 协议获取 binary）
   - 使用 `pngremix-decoder.js` 解码 → `model-normalizer.js` 归一化
   - 构建运行时场景（`buildRuntimeScene`，移植自 `app.js`）
   - 加载所有精灵图片到 `ImageBitmap` / `HTMLImageElement`

2. **渲染循环**：
   - 使用 Canvas2D 渲染（`renderScene`，移植自 `app.js`）
   - 按 `max_fps` 节流帧率
   - 每帧执行：updateGlobalBounce → updateMouseWorld → stepSceneRuntime → renderScene

3. **鼠标跟随**：
   - 监听全局鼠标位置（与 Live2D 共享 `WindowCore` 的全局鼠标追踪机制）
   - 驱动 `follow_type=0` 的部件位置/旋转/缩放（完整移植 `stepNodeRuntime` 的 follow 逻辑）
   - 通过 `PngRemixFeatures.mouse_follow` 和用户设置中的 `pngremix_mouse_follow` 控制开关

4. **自动眨眼**：
   - 定时器驱动（interval = `blink_speed * 1000` ms）
   - 每次触发以 `1/blink_chance` 概率执行眨眼
   - 眨眼时将 `scene.blinking = true`，持续 `blink_speed * blink_hold_ratio` 秒后恢复
   - 完整移植 `app.js` 中的 `triggerBlink` / `startAutoBlink` / `stopAutoBlink`

5. **点击跳跃**：
   - 用户点击角色时触发
   - 通过 `click_bounce_amp` 和 `click_bounce_duration` 控制跳跃曲线
   - 完整移植 `app.js` 中的 `triggerClickBounce` / `updateGlobalBounce`
   - 通过 `PngRemixFeatures.click_bounce` 控制是否启用

6. **表情切换**（对接程序 state）：
   - `playExpression(name: string)`：在 `expressions` 列表中查找 name，切换 `scene.stateId` 为对应 `state_index`
   - 切换后重新渲染

7. **动作触发**（对接程序 state）：
   - `playMotion(name: string)`：在 `motions` 列表中查找 name，获取 `hotkey`，调用 `applyHotkey(scene, hotkey)`
   - 部件显隐立即切换

8. **播放状态**（`playFromAnima`，与 Live2DPlayer 对齐）：
   - 入参：`assetName`（来自 `StateInfo.anima`）
   - 在 `states` 列表中查找匹配的 `state`
   - 如果有 `expression`，调用 `playExpression`
   - 如果有 `motion`，调用 `playMotion`
   - 应用 `scale` / `offset_x` / `offset_y`
   - 返回 `true`（pngremix 无播放时长概念，始终"播放中"）

### PngRemix Window

新增 `src/routes/pngremix/+page.svelte`，结构与 `src/routes/live2d/+page.svelte` 对等。

加载 Mod 时按 `mod_type` 分流：
- `sequence` → 打开 animation window
- `live2d` → 打开 live2d window
- `pngremix` → 打开 pngremix window

### 核心渲染移植清单

从 `other-tool/pngRemix预览/app.js` 移植到 `PngRemixPlayer.ts` 的核心模块：

| 源模块 | 功能 | 移植方式 |
|--------|------|----------|
| `buildRuntimeScene()` | 构建节点树、parent-child、z-sort、图片加载 | TypeScript 重写 |
| `renderScene()` | Canvas2D 合成渲染（blend/clip/tint/visibility） | TypeScript 重写 |
| `stepNodeRuntime()` | 帧级运动更新（wiggle/drag/stretch/follow） | TypeScript 重写 |
| `stepSceneRuntime()` | 场景级帧驱动 | TypeScript 重写 |
| `updateGlobalBounce()` | 全局弹跳 + 点击跳跃 | TypeScript 重写 |
| `triggerBlink()` / `startAutoBlink()` | 眨眼驱动 | TypeScript 重写 |
| `triggerClickBounce()` | 点击跳跃 | TypeScript 重写 |
| `applyHotkey()` / `buildHotkeyGroups()` | F1-F9 组件显隐 | TypeScript 重写 |
| `computeSceneBaseWorldPositions()` | 世界坐标计算（鼠标跟随用） | TypeScript 重写 |

解码器保持独立（作为静态 JS 库加载或转为 TypeScript）：
- `pngremix-decoder.js` → `static/pngremix-decoder.js`（或转 TS）
- `model-normalizer.js` → `static/model-normalizer.js`（或转 TS）

---

## 用户设置扩展

在 `UserSettings` 中新增（与 Live2D 对齐）：

```typescript
// asset.ts
export interface UserSettings {
  // ... 已有 ...
  pngremix_mouse_follow: boolean;    // PngRemix 鼠标跟随
  pngremix_click_bounce: boolean;    // PngRemix 点击跳跃
}
```

对应后端 `storage.rs`：

```rust
pub struct UserSettings {
    // ... 已有 ...
    pub pngremix_mouse_follow: bool,
    pub pngremix_click_bounce: bool,
}
```

---

## StateInfo 扩展

在 `StateInfo` 中新增（与 `live2d_params` 对齐）：

```typescript
export interface StateInfo {
  // ... 已有 ...
  
  /** PngRemix 参数覆写（仅 pngremix 类型 Mod 有效） */
  pngremix_params?: PngRemixParameterSetting[];
}

export interface PngRemixParameterSetting {
  /** 参数类型："expression" 切换表情，"motion" 触发动作 */
  type: "expression" | "motion";
  /** 表情名或动作名 */
  name: string;
}
```

这样在 state 定义中可以同时叠加表情和动作：

```json
{
  "name": "celebrate",
  "anima": "celebrate",
  "pngremix_params": [
    { "type": "expression", "name": "happy" },
    { "type": "motion", "name": "wave" }
  ]
}
```

---

## mod-tool 设计

### 创建流程

新建 Mod 时类型选择扩展为三项：
- `sequence`（序列帧）
- `live2d`（Live2D）
- `pngremix`（PngRemix）

选择 `pngremix` 后：
- 写入 `manifest.mod_type = "pngremix"`
- 生成模板：`asset/pngremix.json`（空配置骨架）
- 提示用户导入 `.pngRemix` 文件

### 编辑页面

根据 `mod_type = "pngremix"` 切换动画配置编辑 UI：

1. **模型配置**（model）
   - `.pngRemix` 文件路径选择
   - 默认 state 索引
   - 帧率限制

2. **特性开关**（features）
   - 鼠标跟随开关
   - 自动眨眼开关 + 速度/概率/持续参数
   - 点击跳跃开关 + 幅度/时长参数

3. **表情编辑器**（expressions）
   - 列表编辑：name + state_index
   - 在编辑器中可预览各 state 效果（调用解码器预览）

4. **动作编辑器**（motions）
   - 列表编辑：name + hotkey（下拉 F1-F9）+ description
   - 自动从 `.pngRemix` 解析 `saved_keys` 检测可用 hotkey 并提示

5. **状态映射**（states）
   - 列表编辑：state + expression + motion + scale + offset

---

## Resource Debugger

根据当前加载 Mod 的 `mod_type`：
- `sequence`：显示 `sequence.json` 与 `img.json`
- `live2d`：显示 `live2d.json`
- `pngremix`：显示 `pngremix.json`（model / features / expressions / motions / states）以及 `.pngRemix` 内部的 sprite 数量、state 数量、可用 hotkey 列表

---

## 共享逻辑抽离

从当前窗口系统中抽取通用逻辑，供三个窗口复用：

- **通用逻辑**（`WindowCore.ts` 已有）：状态监听、触发器、文本/气泡、音频、`on_animation_complete`、`mod_data` 等
- **播放逻辑**（按类型分流）：
  - `SequencePlayer`（序列帧）
  - `Live2DPlayer`（Live2D）
  - `PngRemixPlayer`（PngRemix）— **新增**

---

## 与 Live2D Mod 的关键差异

| 维度 | Live2D Mod | PngRemix Mod |
|------|-----------|--------------|
| 渲染引擎 | pixi.js + pixi-live2d-display | Canvas2D（纯原生） |
| 模型文件 | `.model3.json` + `.moc3` + 纹理 | 单个 `.pngRemix` 二进制文件 |
| 模型解析 | pixi 库内部处理 | 自行解码（Godot Variant Parser） |
| 表情 | `.exp3.json` 文件 | pngRemix state 索引切换 |
| 动作 | `.motion3.json` 文件（有时长） | Hotkey F1-F9 切换部件显隐（瞬发toggle） |
| 鼠标跟随 | Live2D 参数驱动 | follow_type=0 + mouse_delay 驱动位移/旋转/缩放 |
| 眨眼 | Live2D 内建 EyeBlink | should_blink 精灵层互斥 + 定时器 |
| 物理 | Live2D Physics3.json | drag/stretch/rotational_drag + wiggle |
| 图层 | 单个 Live2D 模型 + background_layers | 多精灵层叠合成 |

---

## 预期落地范围

### 后端（src-tauri）
1. `resource.rs`：`ModType` 新增 `Pngremix` 变体
2. `resource.rs`：新增 `PngRemixConfig` 等结构体
3. `resource.rs`：`ModInfo` 新增 `pngremix: Option<PngRemixConfig>` 字段
4. `resource.rs`：加载逻辑支持 `pngremix.json` 解析
5. `storage.rs`：`UserSettings` 新增 `pngremix_mouse_follow` / `pngremix_click_bounce`

### 前端（src）
6. `src/lib/types/asset.ts`：`ModType` 扩展 + PngRemix 相关接口
7. `src/lib/animation/PngRemixPlayer.ts`：PngRemix 播放器（核心新增，约 1500-2000 行）
8. `src/routes/pngremix/+page.svelte`：PngRemix 窗口
9. `src/lib/animation/WindowCore.ts`：`mod_type` 分流支持 pngremix
10. `src/lib/components/Settings.svelte`：新增 pngremix 相关设置项
11. `src/lib/components/ResourceManagerDebugger.svelte`：支持 pngremix 资产展示

### 解码器库
12. `static/pngremix-decoder.js`：从 `other-tool` 复制 / 或转为 TS
13. `static/model-normalizer.js`：从 `other-tool` 复制 / 或转为 TS

### mod-tool
14. 创建流程：新增 `pngremix` 类型选项
15. 编辑页面：新增 pngremix 动画配置编辑 UI

### i18n
16. 各语言 JSON 新增 pngremix 相关 key

---

## 实现优先级建议

1. **P0 — 核心渲染可用**：后端类型 + 前端 PngRemixPlayer + PngRemix Window + 基础表情/动作
2. **P1 — 交互完整**：鼠标跟随 + 眨眼 + 点击跳跃 + 用户设置
3. **P2 — 工具链**：mod-tool 支持 + Resource Debugger
4. **P3 — 优化**：渲染性能优化（OffscreenCanvas、WebWorker 解码等）
