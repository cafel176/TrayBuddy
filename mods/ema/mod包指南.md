# mod包指南 (ASSETS_GUIDE)

本文档旨在说明 `mods` 下的资产包的目录结构以及各配置文件的字段含义。

## 1. 目录结构

```text
mods/mod/
├── manifest.json            # mod主要信息清单
├── preview.png              # mod预览图
├── assets/                  # 动画图像资源
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
| `important_actions` | Object | 关键映射，缺一不可 |
| `actions` | Array | 其他映射 |
| `triggers` | Array | 事件触发 |

### 2.2 `assets/img.json`
定义如何解析对应的动画图像资源。

| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `name` | String | 动画/图像名称 |
| `img` | String | 对应文件名 (相对 `assets/` 目录) |
| `sequence` | Boolean | 是否为序列帧 (如果是设为 true，静态图设为 false) |
| `need_reverse` | Boolean | 循环时是否需要后接反向播放 |
| `frame_time` | Number | 每帧间隔时间 (单位：秒) |
| `frame_size_x` | Number | 单帧的宽度 |
| `frame_size_y` | Number | 单帧的高度 |
| `frame_num_x` | Number | x方向上有多少个单帧 |
| `frame_num_y` | Number | y方向上有多少个单帧 |

### 2.3 `assets/sequence.json`
定义如何解析对应的动画图像资源。

| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `name` | String | 动画/图像名称 |
| `img` | String | 对应文件名 (相对 `assets/` 目录) |
| `sequence` | Boolean | 是否为序列帧 (如果是设为 true，静态图设为 false) |
| `frame_time` | Number | 每帧间隔时间 (单位：秒) |
| `size_x` | Number | 单帧的宽度 |
| `size_y` | Number | 单帧的高度 |
| `gridnum_x` | Number | x方向上有多少个单帧 |
| `gridnum_y` | Number | y方向上有多少个单帧 |

### 2.4 `audio/[lang]/speech.json`
定义音频文件与文本内容的关联。

| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `name` | String | 关联的文本内容名称 (如 `morning`) |
| `audio` | String | 对应音频文件名 (在 `audio/` 目录下) |

### 2.5 `text/[lang]/info.json`
定义角色在该语言下的基础信息。

| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `id` | String | 该语言的id |
| `lang` | String | 该语言的显示名称 |
| `name` | String | 角色在该语言下的显示名称 |

### 2.6 `text/[lang]/speech.json`
定义对应事件触发时显示的文本。

| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `name` | String | 文本的名称 |
| `text` | String | 显示的对话内容 |
