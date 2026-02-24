# mod包指南 (ASSETS_GUIDE)

本文档旨在说明 `mods` 下的资产包的目录结构以及各配置文件的字段含义。

## 1. 目录结构

### 1.1 序列帧 Mod（mod_type: "sequence"）

```text
mods/<mod_id>/
├── manifest.json            # Mod 主要信息清单（必需）
├── preview.png              # Mod 预览图（推荐：PNG/WebP/JPG，必需）
├── icon.ico                 # Mod 图标（推荐：ICO；也可用 icon.png）
├── bubble_style.json        # [可选] 气泡样式自定义配置
├── asset/                   # 动画图像资源
│   ├── img.json             # 杂图索引（数组；可为空）
│   ├── sequence.json        # 序列帧动画索引（数组；可为空）
│   ├── img/                 # 杂图存放处
│   └── sequence/            # 序列帧动画存放处
├── audio/                   # [可选] 音频资源（按语言分目录）
│   └── <lang>/              # 例如：zh / en / jp / ww ...
│       ├── speech.json      # 语音索引（数组）
│       └── speech/          # 语音文件（.wav/.ogg 等）
└── text/                    # 文本资源（按语言分目录）
    └── <lang>/              # 例如：zh / en / jp ...
        ├── info.json        # 角色基本信息
        └── speech.json      # [可选] 对话文本索引（数组；可为空）
```

### 1.2 Live2D Mod（mod_type: "live2d"）

```text
mods/<mod_id>/
├── manifest.json            # Mod 主要信息清单（必需）
├── preview.png              # Mod 预览图
├── icon.ico                 # Mod 图标
├── bubble_style.json        # [可选] 气泡样式自定义配置
├── asset/
│   ├── live2d.json          # Live2D 模型配置（动作/表情/状态映射）
│   └── live2d/              # Live2D 模型资源目录
│       ├── <name>.model3.json   # Cubism 模型描述文件
│       ├── <name>.moc3          # Cubism 模型二进制文件
│       ├── <name>.physics3.json # [可选] 物理运算配置
│       ├── <name>.pose3.json    # [可选] 姿势配置
│       ├── <textures_dir>/      # 贴图目录
│       │   └── *.png
│       ├── motions/             # 动作目录
│       │   └── *.motion3.json
│       └── expressions/         # 表情目录
│           └── *.exp3.json
├── audio/                   # [可选] 音频资源（同序列帧 Mod）
│   └── <lang>/
│       ├── speech.json
│       └── speech/
└── text/                    # 文本资源（同序列帧 Mod）
    └── <lang>/
        ├── info.json
        └── speech.json
```

### 1.3 PngRemix Mod（mod_type: "pngremix"）

```text
mods/<mod_id>/
├── manifest.json            # Mod 主要信息清单（必需）
├── preview.png              # Mod 预览图
├── icon.ico                 # Mod 图标
├── bubble_style.json        # [可选] 气泡样式自定义配置
├── asset/
│   ├── pngremix.json        # PngRemix 配置（模型/特性/表情/动作/状态映射）
│   └── *.pngRemix           # PngRemix 模型文件（二进制）
├── audio/                   # [可选] 音频资源（同序列帧 Mod）
│   └── <lang>/
│       ├── speech.json
│       └── speech/
└── text/                    # 文本资源（同序列帧 Mod）
    └── <lang>/
        ├── info.json
        └── speech.json
```

### 1.4 3D Mod（mod_type: "3d"）

```text
mods/<mod_id>/
├── manifest.json            # Mod 主要信息清单（必需）
├── preview.png              # Mod 预览图
├── icon.ico                 # Mod 图标
├── bubble_style.json        # [可选] 气泡样式自定义配置
├── asset/
│   ├── 3d.json              # 3D 模型配置（模型/动画/状态映射）
│   └── 3d/                  # 3D 资源目录
│       ├── <model>.vrm      # VRM 模型文件（VRM 类型）
│       ├── <model>.pmx      # 或 PMX 模型文件（PMX 类型）
│       ├── textures/        # [可选] PMX 纹理文件目录
│       │   └── *.png / *.bmp / *.tga / *.jpg
│       └── animations/      # 动画文件目录
│           ├── *.vrma        # VRM Animation 文件（VRM 类型）
│           └── *.vmd         # VMD 动画文件（PMX 类型）
├── audio/                   # [可选] 音频资源（同序列帧 Mod）
│   └── <lang>/
│       ├── speech.json
│       └── speech/
└── text/                    # 文本资源（同序列帧 Mod）
    └── <lang>/
        ├── info.json
        └── speech.json
```

---


## 2. 配置文件说明

### 2.1 `manifest.json`
mod主要信息清单文件，决定了程序如何加载该mod。

||| 字段 | 类型 | 说明 |
||| :--- | :--- | :--- |
||| `id` | String | mod唯一标识符 |
||| `version` | String | 适用版本号 |
||| `author` | String | 作者名称 |
||| `mod_type` | String | Mod 类型：`sequence`（序列帧动画）/ `live2d`（Live2D 模型）/ `pngremix`（PngRemix 模型）/ `3d`（3D 模型，VRM/PMX） |
||| `default_audio_lang_id` | String | 找不到对应语言的语音文件时，会使用默认id语言的音频文件 |
||| `default_text_lang_id` | String | 找不到对应语言的文本时，会使用默认id语言的文本 |
||| `character` | Object | 角色渲染配置 |
||| `border` | Object | 边框配置 |
||| `show_mod_data_panel` | Boolean | 是否在动画窗口左上角显示 Mod 数据面板 |
||| `mod_data_default_int` | Number | Mod 数据的默认初始整数值 (首次加载该 Mod 时写入) |
||| `global_keyboard` | Boolean | 是否开启全局键盘监听（开启后无需聚焦动画窗口也能触发 keydown/keyup/global_keydown/global_keyup） |
||| `global_mouse` | Boolean | 是否开启全局鼠标监听（开启后鼠标点击/松开任意位置可触发 global_click/global_click_up/global_right_click/global_right_click_up） |
||| `important_states` | Object | 关键状态映射 (如 `idle`, `silence`)，Key 为状态名，Value 为状态对象 |
||| `states` | Array | 其他普通状态定义数组 |
||| `triggers` | Array | 事件触发定义数组 |


#### 2.1.1 角色配置对象 (Character Object)

||| 字段 | 类型 | 说明 |
||| :--- | :--- | :--- |
||| `z_offset` | Number | Z轴偏移（渲染层级） |
||| `canvas_fit_preference` | String | Canvas 适配模式：`short`(短边优先) / `long`(长边优先) / `legacy`(旧版按高度缩放) |

#### 2.1.2 边框配置对象 (Border Object)

||| 字段 | 类型 | 说明 |
||| :--- | :--- | :--- |
||| `anima` | String | 边框动画名称 (对应 `asset/` 中的配置) |
||| `enable` | Boolean | 是否启用边框 |
||| `z_offset` | Number | Z轴偏移（渲染层级） |

#### 2.1.3 状态对象 (State Object)
用于 `important_states` 和 `states` 中的定义。

- **建议**：`important_states` 里每个状态对象的 `name` 与其 Key 保持一致（例如 Key 为 `idle` 时，`name` 也为 `idle`）。
- **定时触发**：`trigger_time` / `trigger_rate` / `can_trigger_states` 仅在“当前持久状态”下生效（也就是 `persistent: true` 的状态）。

||| 字段 | 类型 | 说明 |
||| :--- | :--- | :--- |
||| `name` | String | 状态名称 |
||| `persistent` | Boolean | 是否为持久状态 |
||| `anima` | String | 关联的动画名称 (对应 `asset/` 中的配置) |
||| `audio` | String | 关联的音频名称 (对应 `audio/` 中的配置) |
||| `text` | String | 关联的文本名称 (对应 `text/` 中的配置) |
||| `priority` | Number | 优先级 (数值越大优先级越高) |
||| `date_start` / `date_end` | String | 有效日期区间 (格式：MM-DD，可选) |
||| `time_start` / `time_end` | String | 有效时间区间 (格式：HH:MM，可选) |
||| `next_state` | String | 播放完成后自动跳转到的下一个状态名称 |
||| `can_trigger_states` | Array | 可随机触发的子状态候选列表。支持字符串数组 `['state1']` 或权重对象数组 `[{'state': 'state1', 'weight': 1}]` |
||| `trigger_time` | Number | 定时触发检查间隔（秒）。0 表示禁用；若 0 < trigger_time < MIN_TRIGGER_TIME_SECS 会被自动修正为最小值（当前为 1 秒） |
||| `trigger_rate` | Number | 每次检查的触发概率 (0.0 - 1.0)。编辑器中通常会以百分比显示 |
||| `trigger_counter_start` | Number | 触发计数范围起点（包含）。当当前 Mod 的 ModData.value 落在 [start, end] 区间内时，该状态才允许触发。默认 -2147483648 |
||| `trigger_counter_end` | Number | 触发计数范围终点（包含）。当当前 Mod 的 ModData.value 落在 [start, end] 区间内时，该状态才允许触发。默认 2147483647 |
||| `trigger_temp_start` | Number | 气温触发范围起点（包含，单位：°C）。当当前 environment.temperature 落在 [start, end] 区间内时，该状态才允许触发。默认 -2147483648 |
||| `trigger_temp_end` | Number | 气温触发范围终点（包含，单位：°C）。当当前 environment.temperature 落在 [start, end] 区间内时，该状态才允许触发。默认 2147483647 |
||| `trigger_uptime` | Number | 启动时长触发门槛（分钟）。当“本次程序启动已运行分钟数” >= trigger_uptime 时，该状态才允许触发。默认 0（不限制） |
||| `trigger_weather` | Array | 天气触发条件（数组任意匹配）。空数组表示不限制；若数组项为纯数字则匹配 environment.condition_code（weatherCode），否则匹配 environment.condition（天气描述，精确匹配）。默认 [] |
||| `mod_data_counter` | Object / null | 进入该状态时对 Mod 数据执行的操作 (可选) |
||| `live2d_params` | Array | （Live2D Mod）进入该状态时覆写 Live2D 参数（数组；可为空）。元素结构：`{id, value, target}`，其中 `target` 可选，取值 `Parameter`（参数值）或 `PartOpacity`（部件透明度），省略时默认 `Parameter` |
||| `pngremix_params` | Array | （PngRemix Mod）进入该状态时触发表情/动作（数组；可为空；元素为 `{type,name}`） |

||| `branch_show_bubble` | Boolean | “显示气泡”：控制对话分支选项是否以气泡形式展示（默认 true） |
||| `branch` | Array | 固定对话分支选项数组，用于交互式对话（为空则无分支） |


#### 2.1.4 分支对象 (Branch Object)
用于状态对象的 `branch` 数组，实现交互式对话选项。

||| 字段 | 类型 | 说明 |
||| :--- | :--- | :--- |
||| `text` | String | 选项按钮显示的文本 |
||| `next_state` | String | 点击该选项后跳转到的状态名称 |

#### 2.1.5 触发器对象 (Trigger Object)
用于 `triggers` 数组。

||| 字段 | 类型 | 说明 |
||| :--- | :--- | :--- |
||| `event` | String | 事件名称（如 `click`, `click_up`, `right_click`, `right_click_up`, `global_click`, `global_click_up`, `global_right_click`, `global_right_click_up`, `global_keydown`, `global_keyup`, `login`, `work`, `birthday`, `firstday`, `login_silence`, `music_start`, `music_end`, `drag_start`, `drag_end`, `keydown:<Key>`, `keyup:<Key>`） |
||| `can_trigger_states` | Array | 触发条件状态组数组，定义在不同持久状态下可触发的状态列表 |


#### 2.1.6 触发条件状态组对象 (TriggerStateGroup Object)
用于触发器对象的 `can_trigger_states` 数组。

||| 字段 | 类型 | 说明 |
||| :--- | :--- | :--- |
||| `persistent_state` | String | 持久状态名称，只有处于该持久状态时才能触发。为空字符串时表示任意持久状态都可触发 |
||| `states` | Array | 可触发的状态列表。支持字符串数组 `['state1']` 或对象数组 `[{'state': 'state1', 'weight': 1}]` 以支持权重随机。 |
||| `allow_repeat` | Boolean | 是否允许连续多次触发相同或相近的状态（默认 `true`）。设为 `false` 时，会排除最近触发过的状态，避免重复。排除的历史状态数量为 `min(3, 可用状态数-1)`，确保至少有一个状态可选。如果 `states` 内只有一个可用状态则忽略此限制。 |

#### 2.1.7 数据计数器对象 (ModDataCounter Object)
用于状态对象的 `mod_data_counter` 字段。

||| 字段 | 类型 | 说明 |
||| :--- | :--- | :--- |
||| `op` | String | 操作类型：`add` (加), `sub` (减), `mul` (乘), `div` (除), `set` (直接设置) |
||| `value` | Number | 操作数 |


**触发器配置示例：**

```json
{
  "triggers": [
    {
      "event": "click",
      "can_trigger_states": [
        {
          "persistent_state": "idle",
          "states": ["hello1_1"],
          "allow_repeat": true
        },
        {
          "persistent_state": "music",
          "states": ["music_hello1_1", "music_hello1_2"],
          "allow_repeat": false
        }
      ]
    },
    {
      "event": "music_start",
      "can_trigger_states": [
        {
          "persistent_state": "",
          "states": ["music_start"]
        }
      ]
    }
  ]
}
```

在上述示例中：
- `click` 事件在 `idle` 持久状态下可触发 `hello1_1`，在 `music` 持久状态下可触发 `music_hello1_1` 或 `music_hello1_2`
- `music` 持久状态下的状态组设置了 `allow_repeat: false`，所以连续点击不会重复触发同一个状态
- `music_start` 事件的 `persistent_state` 为空，表示在任意持久状态下都可触发 `music_start` 状态

### 2.2 `asset/img.json`
定义如何解析对应的动画图像资源。

||| 字段 | 类型 | 说明 |
||| :--- | :--- | :--- |
||| `name` | String | 图像名称 |
||| `img` | String | 对应文件名 (相对 `asset/` 目录) |
||| `sequence` | Boolean | 是否为序列帧 (如果是设为 true，静态图设为 false) |
||| `origin_reverse` | Boolean | 原始帧序列是否已反向排列（从后向前） |
||| `need_reverse` | Boolean | 循环时是否需要后接反向播放 |
||| `frame_time` | Number | 每帧间隔时间 (单位：秒) |
||| `frame_size_x` | Number | 单帧的宽度 |
||| `frame_size_y` | Number | 单帧的高度 |
||| `frame_num_x` | Number | x方向上有多少个单帧 |
||| `frame_num_y` | Number | y方向上有多少个单帧 |
||| `offset_x` | Number | 渲染时 X 轴偏移 (像素) |
||| `offset_y` | Number | 渲染时 Y 轴偏移 (像素) |

### 2.3 `asset/sequence.json`
定义序列帧动画资源。其字段与 `img.json` 完全一致，通常用于存放复杂的动作序列。

||| 字段 | 类型 | 说明 |
||| :--- | :--- | :--- |
||| `name` | String | 动画名称 |
||| `img` | String | 对应文件名 (相对 `asset/` 目录) |
||| `sequence` | Boolean | 是否为序列帧 (如果是设为 true) |
||| `origin_reverse` | Boolean | 原始帧序列是否已反向排列（从后向前） |
||| `need_reverse` | Boolean | 播放完成后是否需要反向播放回起始帧 |
||| `frame_time` | Number | 每帧间隔时间 (秒) |
||| `frame_size_x` | Number | 单帧宽度 |
||| `frame_size_y` | Number | 单帧高度 |
||| `frame_num_x` | Number | 横向帧数 |
||| `frame_num_y` | Number | 纵向帧数 |
||| `offset_x` | Number | 渲染 X 偏移 |
||| `offset_y` | Number | 渲染 Y 偏移 |

### 2.4 `asset/live2d.json`（Live2D Mod 专用）
定义 Live2D 模型的配置信息，包含模型基础参数、动作列表、表情列表和状态-动画映射。

#### 2.4.1 顶层结构

||| 字段 | 类型 | 说明 |
||| :--- | :--- | :--- |
||| `schema_version` | Number | 配置版本号（当前为 `1`） |
||| `model` | Object | 模型基础配置 |
||| `motions` | Array | 动作列表 |
||| `expressions` | Array | 表情列表 |
||| `states` | Array | 状态-动画映射列表 |

#### 2.4.2 模型配置对象 (model)

||| 字段 | 类型 | 说明 |
||| :--- | :--- | :--- |
||| `name` | String | 模型显示名称 |
||| `base_dir` | String | 模型资源根目录，相对于 Mod 目录（如 `asset/live2d/`） |
||| `model_json` | String | 模型描述文件名（如 `mao_pro.model3.json`） |
||| `textures_dir` | String | 贴图目录（相对于 base_dir 内，如 `mao_pro.4096`） |
||| `motions_dir` | String | 动作文件目录（相对于 base_dir 内，如 `motions`） |
||| `expressions_dir` | String | 表情文件目录（相对于 base_dir 内，如 `expressions`） |
||| `physics_json` | String | 物理运算配置文件名（可为空） |
||| `pose_json` | String | 姿势配置文件名（可为空） |
||| `eye_blink` | Boolean | 是否启用自动眨眼 |
||| `lip_sync` | Boolean | 是否启用口型同步 |

#### 2.4.3 动作对象 (Motion Object)

||| 字段 | 类型 | 说明 |
||| :--- | :--- | :--- |
||| `name` | String | 动作名称，供状态映射引用 |
||| `file` | String | 动作文件路径（相对于 base_dir，如 `motions/mtn_01.motion3.json`） |
||| `group` | String | 动作分组（如 `Idle`、`Default` 等） |
||| `priority` | String | 播放优先级（`Idle` / `Normal`） |
||| `fade_in_ms` | Number | 淡入时间（毫秒） |
||| `fade_out_ms` | Number | 淡出时间（毫秒） |
||| `loop` | Boolean | 是否循环播放 |

#### 2.4.4 表情对象 (Expression Object)

||| 字段 | 类型 | 说明 |
||| :--- | :--- | :--- |
||| `name` | String | 表情名称 |
||| `file` | String | 表情文件路径（相对于 base_dir，如 `expressions/exp_01.exp3.json`） |

#### 2.4.5 状态-动画映射对象 (State Mapping Object)
将 `manifest.json` 中状态对象的 `anima` 字段与 Live2D 的具体动作/表情关联起来。

||| 字段 | 类型 | 说明 |
||| :--- | :--- | :--- |
||| `state` | String | 映射名称（对应 manifest 状态的 `anima` 字段值） |
||| `motion` | String | 关联的动作名称（引用 `motions` 中的 `name`） |
||| `expression` | String | 关联的表情名称（引用 `expressions` 中的 `name`，可为空） |
||| `scale` | Number | 模型缩放比例（默认 `1`） |
||| `offset_x` | Number | X 轴偏移（默认 `0`） |
||| `offset_y` | Number | Y 轴偏移（默认 `0`） |

#### 2.4.6 图片资源对象 (Resource Object)
用于 `resources` 数组，定义“可被事件激活的图片资源”，常用于按键高亮叠加。

||| 字段 | 类型 | 说明 |
||| :--- | :--- | :--- |
||| `name` | String | 资源名称（标识用） |
||| `file` | String | 图片路径（相对于 `model.base_dir`） |
||| `dir` | String | 目录（可选，用于工具侧分组/筛选） |
||| `events` | Array | 事件列表（例如 `keydown:KeyA`）。任意一个事件触发时认为该资源“激活” |
||| `audio` | String | **新增**：触发时播放的音效名称（对应 `audio/<lang>/speech.json` 的 `name`；空字符串表示不播放） |

> 说明：当按键事件驱动叠加层显示时，如果匹配到 `resources[].audio`，会同步触发音效播放。

#### 2.4.7 背景层对象 (Background Layer Object)
用于 `background_layers` 数组，在模型下方或上方渲染的图片层（静态背景、按键叠加高亮等）。

||| 字段 | 类型 | 说明 |
||| :--- | :--- | :--- |
||| `name` | String | 层名称（标识用） |
||| `file` | String | 图片路径（相对于 `model.base_dir`） |
||| `layer` | String | 渲染层级：`behind`（模型之后）或 `front`（模型之前） |
||| `scale` | Number | 缩放比例（默认 `1`） |
||| `offset_x` / `offset_y` | Number | 位置偏移（默认 `0`） |
||| `events` | Array | 事件列表；为空则常驻显示；非空则在事件触发时显示/隐藏 |

**示例：**
```json
{
  "schema_version": 1,
  "model": {
    "name": "mao_pro",
    "base_dir": "asset/live2d/",
    "model_json": "mao_pro.model3.json",
    "textures_dir": "mao_pro.4096",
    "motions_dir": "motions",
    "expressions_dir": "expressions",
    "physics_json": "mao_pro.physics3.json",
    "pose_json": "mao_pro.pose3.json",
    "eye_blink": true,
    "lip_sync": true
  },
  "motions": [
    { "name": "mtn_01", "file": "motions/mtn_01.motion3.json", "group": "Idle", "priority": "Idle", "fade_in_ms": 200, "fade_out_ms": 200, "loop": true }
  ],
  "expressions": [
    { "name": "exp_01", "file": "expressions/exp_01.exp3.json" }
  ],
  "states": [
    { "state": "mtn_01", "motion": "mtn_01", "expression": "", "scale": 1, "offset_x": 0, "offset_y": 0 }
  ],
  "resources": [
    { "name": "KeyA", "file": "resources/KeyA.png", "dir": "resources", "audio": "click", "events": ["keydown:KeyA"] }
  ],
  "background_layers": [
    { "name": "background", "file": "resources/bg.png", "layer": "behind", "scale": 1, "offset_x": 0, "offset_y": 0, "events": [] },
    { "name": "KeyA", "file": "resources/KeyA.png", "layer": "front", "scale": 1, "offset_x": 0, "offset_y": 0, "events": ["keydown:KeyA"] }
  ]
}
```

### 2.5 `asset/pngremix.json`（PngRemix Mod 专用）
定义 PngRemix 模型的配置信息，包含模型基础参数、交互特性、表情/动作列表与状态映射。

#### 2.5.1 顶层结构

||| 字段 | 类型 | 说明 |
||| :--- | :--- | :--- |
||| `schema_version` | Number | 配置版本号（当前为 `1`） |
||| `model` | Object | 模型基础配置 |
||| `features` | Object | 交互特性（鼠标跟随、自动眨眼、点击弹跳等） |
||| `expressions` | Array | 表情列表 |
||| `motions` | Array | 动作列表 |
||| `states` | Array | 状态-动画映射列表 |

> **注意**：`features.blink_chance` 的语义为 `1/N`（N>=1，值越大越不容易触发眨眼）。

#### 2.5.2 状态映射对象 (State Mapping Object)

||| 字段 | 类型 | 说明 |
||| :--- | :--- | :--- |
||| `state` | String | 映射名称（对应 manifest 状态的 `anima` 字段值） |
||| `expression` | String | 关联的表情名称（引用 `expressions[].name`，可为空） |
||| `motion` | String | 关联的动作名称（引用 `motions[].name`，可为空） |
||| `mouth_state` | Number | 口型状态：0=Closed，1=Open，2=Screaming；可省略表示不覆写 |
||| `scale` | Number | 模型缩放比例（默认 `1`） |
||| `offset_x` / `offset_y` | Number | 位置偏移（默认 `0`） |

### 2.6 `asset/3d.json`（3D Mod 专用）
定义 3D 模型的配置信息，包含模型基础参数、动画列表与状态映射。

#### 2.6.1 顶层结构

||| 字段 | 类型 | 说明 |
||| :--- | :--- | :--- |
||| `schema_version` | Number | 配置版本号（当前为 `1`） |
||| `model` | Object | 模型基础配置 |
||| `animations` | Array | 动画列表 |
||| `states` | Array | [可选] 状态-动画映射列表（省略时，`manifest` 状态的 `anima` 直接匹配 `animations[].name`） |

#### 2.6.2 模型配置对象 (model)

||| 字段 | 类型 | 说明 |
||| :--- | :--- | :--- |
||| `name` | String | 模型显示名称 |
||| `type` | String | 模型类型：`vrm`（VRM 格式）/ `pmx`（PMX 格式） |
||| `file` | String | 模型文件路径，相对于 Mod 根目录（如 `asset/3d/model.vrm`） |
||| `scale` | Number | 整体缩放系数（默认 `1`） |
||| `offset_x` | Number | X 轴偏移（默认 `0`） |
||| `offset_y` | Number | Y 轴偏移（默认 `0`） |
||| `texture_base_dir` | String | [可选] 纹理文件基础目录，主要用于 PMX 模型（如 `asset/3d/textures`） |
||| `animation_base_dir` | String | [可选] 动画文件基础目录（如 `asset/3d/animations`）。动画的 `file` 字段相对于此目录 |

#### 2.6.3 动画对象 (Animation Object)

||| 字段 | 类型 | 说明 |
||| :--- | :--- | :--- |
||| `name` | String | 动画名称，供状态映射引用 |
||| `type` | String | 动画类型：`vrma`（VRM Animation）/ `vmd`（VMD 格式） |
||| `file` | String | 动画文件路径（相对于 `animation_base_dir`，如 `PET_IDLE.vrma`） |
||| `loop` | Boolean | [可选] 是否循环播放 |
||| `speed` | Number | 播放速度（默认 `1`） |
||| `fps` | Number | 帧率（默认 `60`），主要用于 VRMA 动画 |

#### 2.6.4 状态映射对象 (State Mapping Object)
当 `states` 数组存在时，用于将 `manifest` 状态的 `anima` 字段映射到具体的 3D 动画。

||| 字段 | 类型 | 说明 |
||| :--- | :--- | :--- |
||| `state` | String | 映射名称（对应 manifest 状态的 `anima` 字段值） |
||| `animation` | String | 关联的动画名称（引用 `animations[].name`） |
||| `scale` | Number | [可选] 缩放比例覆写（省略使用模型默认值） |
||| `offset_x` / `offset_y` | Number | [可选] 位置偏移覆写（省略使用模型默认值） |

> **注意**：当 `asset/3d.json` 不存在时，系统会自动扫描 `asset/3d/` 目录下的 `.vrm`/`.pmx` 模型文件和 `.vrma`/`.vmd` 动画文件，按优先级自动选择。

**示例（VRM）：**
```json
{
  "schema_version": 1,
  "model": {
    "name": "HatsuneMikuNT",
    "type": "vrm",
    "file": "asset/3d/HatsuneMikuNT.vrm",
    "scale": 0.9,
    "offset_x": 0,
    "offset_y": 0,
    "texture_base_dir": "",
    "animation_base_dir": "asset/3d/animations"
  },
  "animations": [
    { "name": "pet_idle_1", "type": "vrma", "file": "PET_IDLE 1.vrma", "speed": 1, "fps": 60 },
    { "name": "pet_idle_2", "type": "vrma", "file": "PET_IDLE_2.vrma", "speed": 1, "fps": 60 }
  ]
}
```

**示例（PMX）：**
```json
{
  "schema_version": 1,
  "model": {
    "name": "MyModel",
    "type": "pmx",
    "file": "asset/3d/MyModel.pmx",
    "scale": 0.9,
    "offset_x": 0,
    "offset_y": 0,
    "texture_base_dir": "asset/3d/textures",
    "animation_base_dir": "asset/3d/animations"
  },
  "animations": [
    { "name": "idle", "type": "vmd", "file": "idle.vmd", "speed": 1, "fps": 60 },
    { "name": "wave", "type": "vmd", "file": "wave.vmd", "speed": 1, "fps": 60 }
  ]
}
```

### 2.7 `audio/[lang]/speech.json`
定义音频文件与状态/文本的关联。


||| 字段 | 类型 | 说明 |
||| :--- | :--- | :--- |
||| `name` | String | 关联的标识名称 (对应 `manifest` 中的 `audio` 字段) |
||| `audio` | String | 音频文件路径（相对 `audio/` 目录，如 `jp/speech/morning.wav`） |

### 2.8 `text/[lang]/info.json`
定义角色在该语言下的基础信息。

||| 字段 | 类型 | 说明 |
||| :--- | :--- | :--- |
||| `id` | String | 该语言的id |
||| `lang` | String | 该语言的显示名称 |
||| `name` | String | 角色在该语言下的显示名称 |
||| `description` | String | 角色描述 |

### 2.9 `text/[lang]/speech.json`
定义对应事件触发时显示的文本。

||| 字段 | 类型 | 说明 |
||| :--- | :--- | :--- |
||| `name` | String | 文本的名称 |
||| `text` | String | 显示的对话内容（支持简易 Markdown，支持变量如 `{nickname}` / `{days_used}` / `{usage_hours}` / `{total_usage_hours}` / `{uptime}`） |
||| `duration` | Number | 气泡持续时间（秒，可选）。默认 5 秒，文本显示完成后开始计时 |

#### 2.8.1 简易 Markdown 语法
气泡系统支持以下 Markdown 语法：

||| 语法 | 说明 | 示例 |
||| :--- | :--- | :--- |
||| `**文本**` | 加粗 | `**你好！**` → **你好！** |
||| `[文本](链接)` | 超链接 | `[点我](https://example.com)` |
||| `\n` | 换行 | `第一行\n第二行` |

示例:
```json
{
  "name": "greeting",
  "text": "**你好呀！** 我是你的桌面伙伴～\n有什么可以帮助你的吗？",
  "duration": 5
}
```

### 2.10 `bubble_style.json` (可选)
用于自定义对话气泡的视觉样式（颜色、边框、字体大小等）。若不存在，则使用系统默认样式。

---

## 3. 对话分支系统

对话分支允许用户通过点击选项来决定对话走向。

### 3.1 配置示例

在 `manifest.json` 中的状态定义：

```json
{
  "name": "hello1_1",
  "persistent": false,
  "anima": "wave",
  "audio": "",
  "text": "hello1_1",
  "priority": 2,
  "branch": [
    {
      "text": "好的！",
      "next_state": "hello1_2"
    },
    {
      "text": "再说一次",
      "next_state": "hello1_1"
    }
  ]
}
```

### 3.2 分支流程

1. 状态触发时，显示气泡并播放打字机效果
2. 文本显示完成后，显示分支选项按钮，同时开始持续时间计时
3. 用户点击选项后：
   - 隐藏其他选项，仅显示已选中的选项（禁用状态）
   - 设置 `next_state` 为下一个待切换状态
   - 等待持续时间结束后气泡消失，状态自动切换
4. 如果用户未点击任何选项，持续时间结束后气泡也会自动消失
5. 如果没有分支选项，气泡会在持续时间结束后自动消失

---

## 4. Mod 状态说明

### 4.1 重要状态 (Important States)

以下是系统内置或约定俗成的关键状态，建议在 `important_states` 中定义：

||| 状态名称 | 持久状态 | 说明 |
||| :--- | :--- | :--- |
||| `idle` | ✅ | **默认空闲状态**。系统启动或临时状态播放完毕后通常返回此状态，支持定时随机触发交互。 |
||| `silence` | ✅ | **静默/免打扰状态**。当检测到全屏应用或用户手动开启时进入，通常不应设置随机触发。 |
||| `silence_start` | ❌ | 进入静默模式的过渡状态。 |
||| `silence_end` | ❌ | 退出静默模式返回 `idle` 的过渡状态。 |
||| `dragging` | ✅ | **拖动中状态**。用户拖动动画窗口时进入（持续状态）。 |
||| `drag_start` | ❌ | 开始拖动动画窗口时的过渡状态。通常播放一次后跳转到 `dragging`。 |
||| `drag_end` | ❌ | 结束拖动动画窗口时的过渡状态。通常播放一次后跳转到 `idle`（或由系统判定进入 `music`）。 |
||| `music` | ✅ | **音乐播放状态**。当检测到系统有媒体播放时进入。 |
||| `music_start` | ❌ | 音乐开始播放时的过渡状态。 |
||| `music_end` | ❌ | 音乐停止播放返回 `idle` 的过渡状态。 |
||| `birthday` | ❌ | 用户生日触发状态。 |
||| `firstday` | ❌ | 用户首次运行周年纪念触发状态。 |
