# mod包指南 (ASSETS_GUIDE)

本文档旨在说明 `mods` 下的资产包的目录结构以及各配置文件的字段含义。

## 1. 目录结构

```text
mods/mod/
├── manifest.json            # mod主要信息清单
├── preview.png              # mod预览图
├── asset/                  # 动画图像资源
│   ├── img.json                # 杂图索引
│   ├── sequence.json           # 序列帧动画索引
│   ├── img/                    # 杂图存放处
│   └── sequence/               # 序列帧动画
├── audio/                   # 音频资源
│   └── jp/                     # 日语
│       ├── speech.json             # 语音索引
│       └── speech/                 # 语音文件 (.wav)
└── text/                    # 文本资源
    ├── jp/                     # 日语
    │   ├── info.json               # 角色基本信息
    │   └── speech.json             # 对话文本
    └── zh/                     # 中文
        ├── info.json               # 角色基本信息
        └── speech.json             # 对话文本
```

---

## 2. 配置文件说明

### 2.1 `manifest.json`
mod主要信息清单文件，决定了程序如何加载该mod。

| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `id` | String | mod唯一标识符 |
| `version` | String | 适用版本号 |
| `author` | String | 作者名称 |
| `default_audio_lang_id` | String | 找不到对应语言的语音文件时，会使用默认id语言的音频文件 |
| `default_text_lang_id` | String | 找不到对应语言的文本时，会使用默认id语言的文本 |
| `character` | Object | 角色渲染配置 |
| `border` | Object | 边框配置 |
| `important_states` | Object | 关键状态映射 (如 `idle`) |
| `states` | Array | 其他状态定义数组 |
| `triggers` | Array | 事件触发定义数组 |

#### 2.1.1 角色配置对象 (Character Object)

| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `z_offset` | Number | Z轴偏移（渲染层级） |

#### 2.1.2 边框配置对象 (Border Object)

| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `anima` | String | 边框动画名称 (对应 `asset/` 中的配置) |
| `enable` | Boolean | 是否启用边框 |
| `z_offset` | Number | Z轴偏移（渲染层级） |

#### 2.1.3 状态对象 (State Object)
用于 `important_states` 和 `states` 中的定义。

| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `name` | String | 状态名称 |
| `persistent` | Boolean | 是否为持久状态 |
| `anima` | String | 关联的动画名称 (对应 `asset/` 中的配置) |
| `audio` | String | 关联的音频名称 (对应 `audio/` 中的配置) |
| `text` | String | 关联的文本名称 (对应 `text/` 中的配置) |
| `priority` | Number | 优先级 (数值越大优先级越高) |
| `date_start` / `date_end` | String | 有效日期区间 (格式：MM-DD，可选) |
| `time_start` / `time_end` | String | 有效时间区间 (格式：HH:MM，可选) |
| `next_state` | String | 播放完成后自动跳转到的下一个状态名称 |
| `can_trigger_states` | Array | 处于该状态下可能随机触发的子状态列表 |
| `trigger_time` | Number | 随机触发的最小间隔时间 (秒)，最小值为 300 秒，小于 300 会被自动修正为 300 |
| `trigger_rate` | Number | 随机触发的概率 (0.0 - 1.0) |
| `branch` | Array | 分支选项数组，用于交互式对话 |

#### 2.1.4 分支对象 (Branch Object)
用于状态对象的 `branch` 数组，实现交互式对话选项。

| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `text` | String | 选项按钮显示的文本 |
| `next_state` | String | 点击该选项后跳转到的状态名称 |

#### 2.1.5 触发器对象 (Trigger Object)
用于 `triggers` 数组。

| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `event` | String | 事件名称 (如 `click`, `login`, `music_start`, `music_end`) |
| `can_trigger_states` | Array | 触发条件状态组数组，定义在不同持久状态下可触发的状态列表 |

#### 2.1.6 触发条件状态组对象 (TriggerStateGroup Object)
用于触发器对象的 `can_trigger_states` 数组。

| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `persistent_state` | String | 持久状态名称，只有处于该持久状态时才能触发。为空字符串时表示任意持久状态都可触发 |
| `states` | Array | 可触发的状态名称列表 |

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

| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `name` | String | 图像名称 |
| `img` | String | 对应文件名 (相对 `asset/` 目录) |
| `sequence` | Boolean | 是否为序列帧 (如果是设为 true，静态图设为 false) |
| `origin_reverse` | Boolean | 原始帧序列是否已反向排列（从后向前） |
| `need_reverse` | Boolean | 循环时是否需要后接反向播放 |
| `frame_time` | Number | 每帧间隔时间 (单位：秒) |
| `frame_size_x` | Number | 单帧的宽度 |
| `frame_size_y` | Number | 单帧的高度 |
| `frame_num_x` | Number | x方向上有多少个单帧 |
| `frame_num_y` | Number | y方向上有多少个单帧 |
| `offset_x` | Number | 渲染时 X 轴偏移 (像素) |
| `offset_y` | Number | 渲染时 Y 轴偏移 (像素) |

### 2.3 `asset/sequence.json`
定义序列帧动画资源。其字段与 `img.json` 完全一致，通常用于存放复杂的动作序列。

| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `name` | String | 动画名称 |
| `img` | String | 对应文件名 (相对 `asset/` 目录) |
| `sequence` | Boolean | 是否为序列帧 (如果是设为 true) |
| `origin_reverse` | Boolean | 原始帧序列是否已反向排列（从后向前） |
| `need_reverse` | Boolean | 播放完成后是否需要反向播放回起始帧 |
| `frame_time` | Number | 每帧间隔时间 (秒) |
| `frame_size_x` | Number | 单帧宽度 |
| `frame_size_y` | Number | 单帧高度 |
| `frame_num_x` | Number | 横向帧数 |
| `frame_num_y` | Number | 纵向帧数 |
| `offset_x` | Number | 渲染 X 偏移 |
| `offset_y` | Number | 渲染 Y 偏移 |

### 2.4 `audio/[lang]/speech.json`
定义音频文件与状态/文本的关联。

| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `name` | String | 关联的标识名称 (对应 `manifest` 中的 `audio` 字段) |
| `audio` | String | 音频文件路径 (相对当前 `audio/` 目录，如 `jp/speech/morning.wav`) |

### 2.5 `text/[lang]/info.json`
定义角色在该语言下的基础信息。

| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `id` | String | 该语言的id |
| `lang` | String | 该语言的显示名称 |
| `name` | String | 角色在该语言下的显示名称 |
| `description` | String | 角色描述 |

### 2.6 `text/[lang]/speech.json`
定义对应事件触发时显示的文本。

| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `name` | String | 文本的名称 |
| `text` | String | 显示的对话内容（支持简易 Markdown） |
| `duration` | Number | 气泡持续时间（秒），默认 5 秒，文本显示完成后开始计时 |

#### 2.6.1 简易 Markdown 语法
气泡系统支持以下 Markdown 语法：

| 语法 | 说明 | 示例 |
| :--- | :--- | :--- |
| `**文本**` | 加粗 | `**你好！**` → **你好！** |
| `[文本](链接)` | 超链接 | `[点我](https://example.com)` |
| `\n` | 换行 | `第一行\n第二行` |

示例:
```json
{
  "name": "greeting",
  "text": "**你好呀！** 我是你的桌面伙伴～\n有什么可以帮助你的吗？",
  "duration": 5
}
```

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
