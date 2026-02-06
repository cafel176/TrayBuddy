# mod包指南 (ASSETS_GUIDE)

本文档旨在说明 `mods` 下的资产包的目录结构以及各配置文件的字段含义。

## 1. 目录结构

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

---

## 2. 配置文件说明

### 2.1 `manifest.json`
mod主要信息清单文件，决定了程序如何加载该mod。

||| 字段 | 类型 | 说明 |
||| :--- | :--- | :--- |
||| `id` | String | mod唯一标识符 |
||| `version` | String | 适用版本号 |
||| `author` | String | 作者名称 |
||| `default_audio_lang_id` | String | 找不到对应语言的语音文件时，会使用默认id语言的音频文件 |
||| `default_text_lang_id` | String | 找不到对应语言的文本时，会使用默认id语言的文本 |
||| `character` | Object | 角色渲染配置 |
||| `border` | Object | 边框配置 |
||| `show_mod_data_panel` | Boolean | 是否在动画窗口左上角显示 Mod 数据面板 |
||| `mod_data_default_int` | Number | Mod 数据的默认初始整数值 (首次加载该 Mod 时写入) |
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
||| `mod_data_counter` | Object / null | 进入该状态时对 Mod 数据执行的操作 (可选) |
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
||| `event` | String | 事件名称（如 `click`, `login`, `birthday`, `firstday`, `login_silence`, `music_start`, `music_end`, `animation_drag_start`, `animation_drag_end`, `keydown:<Key>`） |
||| `can_trigger_states` | Array | 触发条件状态组数组，定义在不同持久状态下可触发的状态列表 |

- **提示**：拖拽相关的事件名是 `animation_drag_start` / `animation_drag_end`，不要与状态名 `drag_start` / `drag_end` 混淆。

#### 2.1.6 触发条件状态组对象 (TriggerStateGroup Object)
用于触发器对象的 `can_trigger_states` 数组。

||| 字段 | 类型 | 说明 |
||| :--- | :--- | :--- |
||| `persistent_state` | String | 持久状态名称，只有处于该持久状态时才能触发。为空字符串时表示任意持久状态都可触发 |
||| `states` | Array | 可触发的状态列表。支持字符串数组 `['state1']` 或对象数组 `[{'state': 'state1', 'weight': 1}]` 以支持权重随机。 |

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
          "states": ["hello1_1"]
        },
        {
          "persistent_state": "music",
          "states": ["music_hello1_1"]
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
- `click` 事件在 `idle` 持久状态下可触发 `hello1_1`，在 `music` 持久状态下可触发 `music_hello1_1`
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

### 2.4 `audio/[lang]/speech.json`
定义音频文件与状态/文本的关联。

||| 字段 | 类型 | 说明 |
||| :--- | :--- | :--- |
||| `name` | String | 关联的标识名称 (对应 `manifest` 中的 `audio` 字段) |
||| `audio` | String | 音频文件路径（相对 `audio/` 目录，如 `jp/speech/morning.wav`） |

### 2.5 `text/[lang]/info.json`
定义角色在该语言下的基础信息。

||| 字段 | 类型 | 说明 |
||| :--- | :--- | :--- |
||| `id` | String | 该语言的id |
||| `lang` | String | 该语言的显示名称 |
||| `name` | String | 角色在该语言下的显示名称 |
||| `description` | String | 角色描述 |

### 2.6 `text/[lang]/speech.json`
定义对应事件触发时显示的文本。

||| 字段 | 类型 | 说明 |
||| :--- | :--- | :--- |
||| `name` | String | 文本的名称 |
||| `text` | String | 显示的对话内容（支持简易 Markdown，支持变量如 `{nickname}`） |
||| `duration` | Number | 气泡持续时间（秒，可选）。默认 5 秒，文本显示完成后开始计时 |

#### 2.6.1 简易 Markdown 语法
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

### 2.7 `bubble_style.json` (可选)
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
