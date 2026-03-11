## pngRemix 字段支持审计报告（TrayBuddy）

### 审计对象
- `mods_test/pngremix_test/asset/望.pngRemix`
- `mods_release/sherry/asset/橘雪莉251004.pngRemix`
- `71.pngRemix`

### 审计方法（使用程序内已有解析工具）
- 解码：`static/pngremix-decoder.js`（Godot4 Variant 反序列化）
- 标准化/兼容：`static/model-normalizer.js`（补默认值、兼容 legacy 字段、解析贴图 bytes）
- 运行时生效判定：对照 `src/lib/animation/PngRemixPlayer.ts` 当前实现实际读取的 state/setting 字段
- 生成工具脚本：`other-tool/pngRemix预览/field-audit.cjs`
- 原始 JSON 结果：`test_logs/pngremix-field-audit.json`

> 说明：本报告里的“unsupportedStateKeys”表示 **文件中确实出现过**、但当前 `PngRemixPlayer` 不读取/不产生效果的组件 state 字段。
> “unsupportedSpriteKeys”表示 **sprite 对象层**出现过、但当前（`model-normalizer` + `PngRemixPlayer`）并不会用于播放/渲染效果的字段（多为资产开关/热键/编辑器元数据）。

---

### 每个文件的概览

#### 1) 望.pngRemix
- spriteCount: 71
- stateCount: 9
- stateKeyCount: 204
- spriteKeyCount: 19
- settingsKeys（文件内出现的全局设置 key）：
  - 含：`blink_speed`、`blink_chance`、`bounce_state`、`should_delta`、`max_fps`、`xAmp/xFrq/yAmp/yFrq` 等
  - 也包含大量编辑器/工程类设置（例如 `auto_save`、`monitor`、`saved_inputs` 等），播放器不会直接用它们驱动渲染

#### 2) 橘雪莉251004.pngRemix
- spriteCount: 98
- stateCount: 5
- stateKeyCount: 204
- spriteKeyCount: 19
- settingsKeys：与 `望.pngRemix` 基本一致（同一套 PNGTuber Remix 工程保存字段）

#### 3) 71.pngRemix
- version: 1.4
- spriteCount: 89
- stateCount: 1
- stateKeyCount: 203
- spriteKeyCount: 22
- settingsKeys：包含 `cycles`、`snap_out_of_bounds`、`trimmed`、`language/preferred_language` 等额外工程字段

---

### 当前程序无法支持（不会生效）的组件 state 字段

> 以下列表在本次 3 个文件中基本一致（即：这些字段在文件里出现过，但当前播放实现未用到）。

- `_keys`（元数据）

- 链条/网格/物理扩展（未实现）
  - `chain_rot_max`, `chain_rot_min`, `chain_softness`
  - `mesh_phys_x`, `mesh_phys_y`
  - `rotation_threshold`, `tip_point`, `static_obj`, `hidden_item`

- 眼睛注视/风格类（未实现）
  - `gaze_eye`, `style_eye`, `follow_eye`

- Wa/跟随扩展参数（未实现）
  - `follow_wa_max`, `follow_wa_mini`, `follow_wa_tip`
  - `follow_mouth`, `follow_range`, `follow_strength`

- 淡入淡出（未实现）
  - `fade`, `fade_asset`, `fade_speed`, `fade_speed_asset`

- UDP 驱动（未实现）
  - `udp_pos`, `udp_rot`, `udp_scale`, `use_object_pos`

- “交换/吸附/索引变换”类（未实现）
  - `pos_swap_x`, `pos_swap_y`, `scale_swap_x`, `scale_swap_y`
  - `snap_rot`, `snap_scale`
  - `index_change`, `index_change_y`
  - 以及其 `mo_` / `scream_` 变体：
    - `mo_index_change`, `mo_index_change_y`
    - `scream_index_change`, `scream_index_change_y`
    - `mo_pos_swap_x`, `mo_pos_swap_y`, `mo_scale_swap_x`, `mo_scale_swap_y`
    - `scream_pos_swap_x`, `scream_pos_swap_y`, `scream_scale_swap_x`, `scream_scale_swap_y`

- 鼠标跟随扩展（未实现）
  - `mouse_rotation`, `mouse_rotation_min`, `mouse_rotation_max`
  - `mouse_scale_x`, `mouse_scale_y`
  - 以及其 `mo_` / `scream_` 变体：
    - `mo_mouse_rotation`, `mo_mouse_rotation_max`, `mo_mouse_scale_x`, `mo_mouse_scale_y`
    - `scream_mouse_rotation`, `scream_mouse_rotation_max`, `scream_mouse_scale_x`, `scream_mouse_scale_y`
    - `scream_mouse_pos_min`, `scream_mouse_pos_max`, `scream_mouse_pos_y_min`, `scream_mouse_pos_y_max`

- Wiggle 扩展（基础 wiggle 有实现，但以下未实现）
  - `wiggle_physics`, `wiggle_rot_offset`

- 循环标记/编辑器字段（当前未用于播放）
  - `is_cycle`, `cycle`
  - `editing_for`

---

### 当前程序不会用于播放/渲染效果的 sprite 级字段（文件中出现过）

#### 望.pngRemix / 橘雪莉251004.pngRemix
- `_keys`
- `img_animated`（如果作为 sprite 顶层字段出现，当前不会被使用；播放器按 `image_id/normal_id` 或 `img/normal` 解析贴图）
- `is_asset`, `was_active_before`
- `saved_keys`, `saved_event`
- `should_disappear`, `show_only`
- `is_collapsed`, `is_premultiplied`

#### 71.pngRemix
- `_keys`
- `is_asset`, `was_active_before`
- `saved_disappear`, `saved_event`
- `should_disappear`, `show_only`
- `is_collapsed`, `is_premultiplied`
- `layer_color`, `rest_mode`

---

### 备注：已支持但不在“未支持列表”里的典型字段
- sprite 建树/贴图解析（由 `model-normalizer` 处理）：`sprite_id/parent_id/sprite_type/sprite_name/states`、以及 `image_id/normal_id/img/normal/image_data/normal_data` 等
- 渲染变换/动画（由 `PngRemixPlayer` 处理）：`position/rotation/scale/offset`、`visible/z_index`、`clip`、`blend_mode/colored/tint`、`wiggle/wiggle_amp/wiggle_freq`、`follow_type*`、`animate_to_mouse*`、`xAmp/yAmp/xFrq(yFrq)/xFreq(yFreq)`、`dragSpeed/stretchAmount/rdragStr/rot_frq` 等

