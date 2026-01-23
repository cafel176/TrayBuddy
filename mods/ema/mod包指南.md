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
| `trigger_time` | Number | 随机触发的最小间隔时间 (秒) |
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
| `can_trigger_states` | Array | 该事件触发时，从中随机选出的目标状态列表 |

### 2.2 `asset/img.json`
定义如何解析对应的动画图像资源。

| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `name` | String | 图像名称 |
| `img` | String | 对应文件名 (相对 `asset/` 目录) |
| `sequence` | Boolean | 是否为序列帧 (如果是设为 true，静态图设为 false) |
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
| `text` | String | 显示的对话内容 |
