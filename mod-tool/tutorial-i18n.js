// Tutorial i18n translations
const tutorialTranslations = {
  zh: {
    tutorial_title: "TrayBuddy Mod 教程",
    nav_brand: "TrayBuddy Mod Editor",
    footer_copyright: "TrayBuddy Mod Editor © 2024",
    back_to_editor: "返回编辑器",
    lang_zh: "中文",
    lang_en: "EN",
    lang_ja: "JA",
    sidebar_toc: "目录",

    // TOC
    tut_toc_new_mod: "如何新建 Mod",
    tut_toc_sequence: "序列帧 Mod",
    tut_toc_live2d: "Live2D Mod",
    tut_toc_pngremix: "PngRemix Mod",
    tut_toc_states_triggers: "状态和触发",

    // Page header
    tut_page_title: "📚 Mod 创建教程",
    tut_page_lead: "本教程将逐步指导你如何创建不同类型的 Mod，包括序列帧、Live2D 和 PngRemix。",
    tut_warning_title: "⚠️ 注意",
    tut_warning_desc: '本项目仍处于早期阶段，如果您有任何疑问，欢迎联系我们。QQ群：<a href="imgs/QQ群.jpg" target="_blank" rel="noopener noreferrer">578258773</a> &nbsp; Bilibili: <a href="https://b23.tv/ZKVKHH0" target="_blank" rel="noopener noreferrer">_Cafel_</a>',

    // ===== 如何新建Mod =====
    tut_section_new_mod: "📦 如何新建 Mod",
    tut_open_editor: "打开 Mod 编辑器",
    tut_open_editor_desc: "在安装并打开程序后，您可以右键托盘图标或人物挂件以打开右键菜单，之后选择 <strong>Mod编辑器</strong>。",
    tut_open_bat_desc: "系统会打开一个文件夹，请直接双击 <strong>打开-mod编辑器.bat</strong>",
    tut_browser_open_desc: "您的Web浏览器会启动一个新的窗口，这就是我们的Mod编辑器",
    tut_create_mod: "新建 Mod",
    tut_create_mod_desc: "在打开Mod编辑器后，您可以点击右上角的 <strong>新建Mod</strong> 按钮",
    tut_fill_info_desc: "之后，请在弹出的窗口内填写基本信息，并根据您的动画类型选择对应的Mod类型，最后点击 <strong>创建</strong>",
    tut_save_first_desc: "创建完成后，请注意此时Mod还并没有在本地创建任何文件，因此推荐您首先点击右上角的 <strong>保存</strong> 并选择一个文件夹",
    tut_tip_save_title: "💡 提示",
    tut_tip_save_desc: "我们推荐您将Mod保存目录设置为 <strong>程序安装目录内的mods文件夹</strong>，这样启动程序时可以直接加载您的新Mod而无需任何额外操作",
    tut_save_success_desc: "等待系统右下角出现 <strong>保存成功</strong> 的提示之后，相关的文件就被保存到了目标文件夹中",
    tut_start_creating: "您现在可以开始正式创作您的Mod了",

    // ===== 序列帧 Mod =====
    tut_section_sequence: "🎬️ 如何快速创建序列帧 Mod",
    tut_seq_process_anim: "处理动画",
    tut_seq_open_tools_desc: "在安装并打开程序后，您可以右键托盘图标或人物挂件以打开右键菜单，之后选择 <strong>其他工具</strong>",
    tut_seq_toolchain_desc: "系统会打开一个文件夹，这里陈列了TrayBuddy提供的工具链",
    tut_seq_convert_desc: "不论您的原始素材是 <strong>GIF/视频/一组差别png</strong>，您都可以使用工具链中的工具来将他们转换为SpriteSheet",
    tut_seq_table_tool: "工具",
    tut_seq_table_function: "功能",
    tut_seq_tool_gif: "GIF 提取序列帧",
    tut_seq_tool_gif_desc: "从 GIF 动图提取帧序列",
    tut_seq_tool_video: "视频提取序列帧",
    tut_seq_tool_video_desc: "从视频文件提取帧序列",
    tut_seq_tool_gen: "Spritesheet 生成",
    tut_seq_tool_gen_desc: "将差别图组合并为精灵图",
    tut_seq_tool_split: "Spritesheet 切分",
    tut_seq_tool_split_desc: "将精灵图拆分为单帧",
    tut_seq_tool_compress: "Spritesheet 压缩",
    tut_seq_tool_compress_desc: "精灵图体积优化",
    tut_seq_tool_preview: "序列帧预览",
    tut_seq_tool_preview_desc: "预览 差分图组/Spritesheet 动画效果",
    tut_seq_tool_align: "序列帧对齐工具",
    tut_seq_tool_align_desc: "帧对齐和偏移调整",
    tut_seq_tool_batch: "批量裁切缩放",
    tut_seq_tool_batch_desc: "批量图片处理",
    tut_seq_add_anim: "添加动画",
    tut_seq_add_anim_desc: "当您拥有了第一个Spritesheet后，回到Mod编辑器，选择 <strong>动画</strong> 界面",
    tut_seq_import_desc: "请在 <strong>序列帧动画 (sequence.json)</strong> 右边点击 <strong>导入</strong> 按钮",
    tut_seq_edit_desc: "选择您刚才的SpriteSheet后，编辑器会导入并生成一个新的动画，此时点击 <strong>编辑</strong> 按钮",
    tut_seq_frame_desc: "请根据您的SpriteSheet，填写 <strong>横向帧数和纵向帧数</strong>，如果您的填写无误，帧宽度和帧高度会自动计算出来，确认无误后，点击 <strong>保存</strong>",
    tut_seq_add_state: "添加状态",
    tut_seq_add_state_desc: "当您拥有了第一个动画后，选择 <strong>状态和触发</strong> 界面",
    tut_seq_edit_idle_desc: "展开 <strong>核心状态</strong> 分类标签，点击 <strong>idle</strong> 状态的 <strong>编辑</strong> 按钮",
    tut_seq_assoc_anim_desc: "在打开的窗口内，找到 <strong>关联动画</strong> 下拉菜单，选择您刚才的动画，并点击保存",
    tut_seq_done_desc: "至此您就完成了一个最简单的序列帧Mod的创建，不要忘记点击 <strong>保存</strong> 将修改保存到您的文件夹",
    tut_seq_debug_desc: "之后如果您的Mod保存在 <strong>程序安装目录内的mods文件夹</strong>，您可以直接启动程序调试您的Mod",

    // ===== Live2D Mod =====
    tut_section_live2d: "🎭 如何快速创建 Live2D Mod",
    tut_l2d_import_assets: "导入资产",
    tut_l2d_open_anim_desc: "进入Mod编辑器，选择 <strong>动画</strong> 界面",
    tut_l2d_import_folder_desc: "请在顶部按钮中点击 <strong>导入文件夹</strong> 按钮，选择live2d文件，<strong>保证model3.json直接处于该目录下</strong>，并等待右下角出现导入成功的提示",
    tut_l2d_sync_config_desc: "请在顶部按钮中点击 <strong>从文件同步配置</strong> 按钮，并检查 <strong>模型配置 (live2d.json - model)</strong> 分类签下的内容是否正确，如不正确，请自行补充",
    tut_l2d_sync_assets_desc: "请在顶部按钮中点击 <strong>从文件同步资产</strong> 按钮，并检查 <strong>表情列表 (expressions) / 动作列表 (motions) / 背景/叠加图层 (background_layers) / 状态-动画映射 (states)</strong> 分类签下的内容是否正确",
    tut_l2d_edit_states_desc: "您也可以自己编辑状态映射，根据您的需求删除多余状态，或将动作和表情映射到同一个状态内",
    tut_l2d_gen_input_desc: "请在顶部按钮中点击 <strong>从文件生成输入事件</strong> 按钮，以根据live2d内配置的参数生成输入事件",
    tut_l2d_bongocat_desc: '如果您的live2d是BongoCat，则配置到此结束了，请继续下一步：<a href="#states-triggers">状态和触发</a>。如果不是，请继续查看后续内容',
    tut_l2d_add_states: "添加状态",
    tut_l2d_add_states_desc: "当 <strong>状态-动画映射 (states)</strong> 分类标签下的内容正确后，您可以点击每一项的 <strong>新增同名状态</strong> 按钮来新增对应状态。不过当前教程中我们只创建了一个 <strong>idle</strong> 状态，其他状态的处理请参以后的教程",
    tut_l2d_go_states_desc: "全部映射完成后，选择 <strong>状态和触发</strong> 界面",
    tut_l2d_edit_idle_desc: "展开 <strong>核心状态</strong> 分类标签，点击 <strong>idle</strong> 状态的 <strong>编辑</strong> 按钮",
    tut_l2d_assoc_anim_desc: "在打开的窗口内，找到 <strong>关联动画</strong> 下拉菜单，选择您刚才的动画，并点击保存",
    tut_l2d_done_desc: "至此您就完成了一个最简单的live2d Mod的创建，不要忘记点击 <strong>保存</strong> 将修改保存到您的文件夹",
    tut_l2d_debug_desc: "之后如果您的Mod保存在 <strong>程序安装目录内的mods文件夹</strong>，您可以直接启动程序调试您的Mod",

    // ===== PngRemix Mod =====
    tut_section_pngremix: "🧩 如何快速创建 PngRemix Mod",
    tut_pr_import_assets: "导入资产",
    tut_pr_open_anim_desc: "进入Mod编辑器，选择 <strong>动画</strong> 界面",
    tut_pr_import_file_desc: "请在顶部按钮中点击 <strong>导入文件</strong> 按钮，选择pngremix文件，并等待右下角出现导入成功的提示",
    tut_pr_sync_config_desc: "请在顶部按钮中点击 <strong>从文件同步配置</strong> 按钮，并检查 <strong>模型配置 (pngremix.json - model)</strong> 分类签下的内容是否正确，如不正确，请自行补充",
    tut_pr_sync_assets_desc: "请在顶部按钮中点击 <strong>从文件同步资产</strong> 按钮，并检查 <strong>表情列表 (expressions) / 动作列表 (motions) / 状态映射 (states)</strong> 分类签下的内容是否正确",
    tut_pr_edit_states_desc: "当然您也可以自己编辑状态映射，根据您的需求删除多余状态，或将动作和表情映射到同一个状态内",
    tut_pr_add_states: "添加状态",
    tut_pr_add_states_desc: "当 <strong>状态映射 (states)</strong> 分类标签下的内容正确后，您可以点击每一项的 <strong>新增同名状态</strong> 按钮来新增对应状态。不过当前教程中我们只创建了一个 <strong>idle</strong> 状态，其他状态的处理请参以后的教程",
    tut_pr_go_states_desc: "全部映射完成后，选择 <strong>状态和触发</strong> 界面",
    tut_pr_edit_idle_desc: "展开 <strong>核心状态</strong> 分类标签，点击 <strong>idle</strong> 状态的 <strong>编辑</strong> 按钮",
    tut_pr_assoc_anim_desc: "在打开的窗口内，找到 <strong>关联动画</strong> 下拉菜单，选择您刚才的动画，并点击保存",
    tut_pr_done_desc: "至此您就完成了一个最简单的pngremix Mod的创建，不要忘记点击 <strong>保存</strong> 将修改保存到您的文件夹",
    tut_pr_debug_desc: "之后如果您的Mod保存在 <strong>程序安装目录内的mods文件夹</strong>，您可以直接启动程序调试您的Mod",

    // ===== 状态和触发 =====
    tut_section_states_triggers: "🎭 状态和触发",
    tut_st_states: "状态",
    tut_st_intro_desc: "本程序简单来讲就是个有限状态机，状态和触发是它的核心",
    tut_st_categories_desc: "状态一共分为3类，<strong>核心状态</strong>，<strong>重要状态</strong>，<strong>普通状态</strong>",
    tut_st_core_desc: "其中核心状态和重要状态不可增删，由系统写死。普通状态可以随意的新增和删除。",
    tut_st_bind_desc: "这三类状态的配置都是一样的，每个状态都可以绑定 <strong>关联音频</strong> <strong>关联动画</strong> <strong>关联文本</strong>",
    tut_st_dropdown_desc: "当你在 <strong>多语言文本</strong> <strong>多语言音频</strong> <strong>动画</strong> 界面内添加了对应内容后，下拉菜单就可以将添加的内容和状态绑定到一起",
    tut_st_triggers: "触发",
    tut_st_triggers_intro_desc: "状态定义好之后，由不同的触发来使得程序执行对应的状态",
    tut_st_triggers_types_desc: "您可以从状态和触发界面的最下方找到当前所有支持的触发类型",
    tut_st_click_intro_desc: "这里介绍最常用的一种：<strong>鼠标点击</strong>",
    tut_st_click_desc: "您可以从 <strong>触发器 (事件响应)</strong> 分类签内找到 <strong>click</strong> 事件，该事件对应的就是鼠标左键点击角色挂件，点击编辑该事件",
    tut_st_add_group_desc: "请点击 <strong>添加状态组</strong> 按钮",
    tut_st_skip_select_desc: "请不要管 选择状态 下拉菜单，不提供持久状态意味着任何持久状态下都可以触发。直接点击 <strong>添加状态</strong> 按钮",
    tut_st_select_state_desc: "在新添加的项的下拉菜单内选择状态，即可将该状态加入点击可触发的状态列表内，之后点击保存",
    tut_st_result_desc: "至此，您在点击您的宠物时就可以使得其播放新的动画音频和文本了",
    tut_st_save_reminder_desc: "不要忘记点击 <strong>保存</strong> 将修改保存到您的文件夹",
    tut_st_debug_desc: "之后如果您的Mod保存在 <strong>程序安装目录内的mods文件夹</strong>，您可以直接启动程序调试您的Mod",
    tut_more_coming_title: "💡 提示",
    tut_more_coming_desc: "<strong>更多内容有待后续更新</strong>",

    // ===== 图片路径 =====
    tut_img_new1: "imgs/zh/tutorial_new1.png",
    tut_img_new3: "imgs/zh/tutorial_new3.png",
    tut_img_new4: "imgs/zh/tutorial_new4.png",
    tut_img_newmod: "imgs/zh/newmod.png",
    tut_img_new5: "imgs/zh/tutorial_new5.png",
    tut_img_new6: "imgs/zh/tutorial_new6.png",
    tut_img_seq1: "imgs/zh/tutorial_sequence1.png",
    tut_img_seq3: "imgs/zh/tutorial_sequence3.png",
    tut_img_seq4: "imgs/zh/tutorial_sequence4.png",
    tut_img_seq6: "imgs/zh/tutorial_sequence6.png",
    tut_img_seq7: "imgs/zh/tutorial_sequence7.png",
    tut_img_seq8: "imgs/zh/tutorial_sequence8.png",
    tut_img_seq9: "imgs/zh/tutorial_sequence9.png",
    tut_img_l2d1: "imgs/zh/tutorial_live2d1.png",
    tut_img_l2d2: "imgs/zh/tutorial_live2d2.png",
    tut_img_l2d3: "imgs/zh/tutorial_live2d3.png",
    tut_img_l2d4: "imgs/zh/tutorial_live2d4.png",
    tut_img_pr1: "imgs/zh/tutorial_pngremix1.png",
    tut_img_pr2: "imgs/zh/tutorial_pngremix2.png",
    tut_img_pr3: "imgs/zh/tutorial_pngremix3.png",
    tut_img_pr4: "imgs/zh/tutorial_pngremix4.png",
    tut_img_st1: "imgs/zh/states_triggers1.png",
    tut_img_st2: "imgs/zh/states_triggers2.png",
    tut_img_st3: "imgs/zh/states_triggers3.png",
    tut_img_st4: "imgs/zh/states_triggers4.png",
    tut_img_st5: "imgs/zh/states_triggers5.png",
    tut_img_st6: "imgs/zh/states_triggers6.png",
    tut_img_st7: "imgs/zh/states_triggers7.png",
  },

  en: {
    tutorial_title: "TrayBuddy Mod Tutorial",
    nav_brand: "TrayBuddy Mod Editor",
    footer_copyright: "TrayBuddy Mod Editor © 2024",
    back_to_editor: "Back to Editor",
    lang_zh: "中文",
    lang_en: "EN",
    lang_ja: "JA",
    sidebar_toc: "Contents",

    // TOC
    tut_toc_new_mod: "Create a New Mod",
    tut_toc_sequence: "Sequence Frame Mod",
    tut_toc_live2d: "Live2D Mod",
    tut_toc_pngremix: "PngRemix Mod",
    tut_toc_states_triggers: "States and Triggers",

    // Page header
    tut_page_title: "📚 Mod Creation Tutorial",
    tut_page_lead: "This tutorial will guide you step by step on how to create different types of Mods, including Sequence Frames, Live2D, and PngRemix.",
    tut_warning_title: "⚠️ Notice",
    tut_warning_desc: 'This project is still in its early stages. If you have any questions, feel free to contact us. QQ Group: <a href="imgs/QQ群.jpg" target="_blank" rel="noopener noreferrer">578258773</a> &nbsp; Bilibili: <a href="https://b23.tv/ZKVKHH0" target="_blank" rel="noopener noreferrer">_Cafel_</a>',

    // ===== How to Create a New Mod =====
    tut_section_new_mod: "📦 How to Create a New Mod",
    tut_open_editor: "Open the Mod Editor",
    tut_open_editor_desc: "After installing and opening the application, you can right-click the tray icon or the character widget to open the context menu, then select <strong>Mod Editor</strong>.",
    tut_open_bat_desc: "A folder will open. Simply double-click <strong>打开-mod编辑器.bat</strong>",
    tut_browser_open_desc: "Your web browser will launch a new window — this is our Mod Editor",
    tut_create_mod: "Create a New Mod",
    tut_create_mod_desc: "After opening the Mod Editor, you can click the <strong>New Mod</strong> button in the top-right corner",
    tut_fill_info_desc: "Next, fill in the basic information in the popup window, select the corresponding Mod type based on your animation type, and click <strong>Create</strong>",
    tut_save_first_desc: "After creation, please note that no files have been created locally yet. It is recommended to click <strong>Save</strong> in the top-right corner first and choose a folder",
    tut_tip_save_title: "💡 Tip",
    tut_tip_save_desc: "We recommend saving your Mod to the <strong>mods folder within the application installation directory</strong>. This way, the program can directly load your new Mod on startup without any extra steps",
    tut_save_success_desc: "Once the <strong>Save Successful</strong> notification appears in the bottom-right corner of the system, the related files have been saved to the target folder",
    tut_start_creating: "You can now start creating your Mod",

    // ===== Sequence Frame Mod =====
    tut_section_sequence: "🎬️ How to Quickly Create a Sequence Frame Mod",
    tut_seq_process_anim: "Process Animations",
    tut_seq_open_tools_desc: "After installing and opening the application, you can right-click the tray icon or the character widget to open the context menu, then select <strong>Other Tools</strong>",
    tut_seq_toolchain_desc: "A folder will open, displaying the toolchain provided by TrayBuddy",
    tut_seq_convert_desc: "Regardless of whether your original assets are <strong>GIF / video / a set of differential PNGs</strong>, you can use the tools in the toolchain to convert them into a SpriteSheet",
    tut_seq_table_tool: "Tool",
    tut_seq_table_function: "Function",
    tut_seq_tool_gif: "GIF Extract Frames",
    tut_seq_tool_gif_desc: "Extract frame sequences from GIF animations",
    tut_seq_tool_video: "Video Extract Frames",
    tut_seq_tool_video_desc: "Extract frame sequences from video files",
    tut_seq_tool_gen: "Spritesheet Generate",
    tut_seq_tool_gen_desc: "Merge differential images into a sprite sheet",
    tut_seq_tool_split: "Spritesheet Split",
    tut_seq_tool_split_desc: "Split a sprite sheet into individual frames",
    tut_seq_tool_compress: "Spritesheet Compress",
    tut_seq_tool_compress_desc: "Optimize sprite sheet file size",
    tut_seq_tool_preview: "Sequence Frame Preview",
    tut_seq_tool_preview_desc: "Preview differential images / SpriteSheet animation effects",
    tut_seq_tool_align: "Sequence Frame Alignment Tool",
    tut_seq_tool_align_desc: "Frame alignment and offset adjustment",
    tut_seq_tool_batch: "Batch Crop & Resize",
    tut_seq_tool_batch_desc: "Batch image processing",
    tut_seq_add_anim: "Add Animation",
    tut_seq_add_anim_desc: "Once you have your first SpriteSheet, go back to the Mod Editor and select the <strong>Animation</strong> tab",
    tut_seq_import_desc: "Click the <strong>Import</strong> button to the right of <strong>Sequence Frame Animation (sequence.json)</strong>",
    tut_seq_edit_desc: "After selecting your SpriteSheet, the editor will import and generate a new animation. Then click the <strong>Edit</strong> button",
    tut_seq_frame_desc: "Based on your SpriteSheet, fill in the <strong>horizontal frame count and vertical frame count</strong>. If your input is correct, the frame width and frame height will be calculated automatically. After confirming, click <strong>Save</strong>",
    tut_seq_add_state: "Add State",
    tut_seq_add_state_desc: "Once you have your first animation, select the <strong>States and Triggers</strong> tab",
    tut_seq_edit_idle_desc: "Expand the <strong>Core States</strong> category, and click the <strong>Edit</strong> button for the <strong>idle</strong> state",
    tut_seq_assoc_anim_desc: "In the opened window, find the <strong>Associated Animation</strong> dropdown menu, select your animation, and click Save",
    tut_seq_done_desc: "You have now completed the creation of a basic sequence frame Mod. Don't forget to click <strong>Save</strong> to save your changes to your folder",
    tut_seq_debug_desc: "After that, if your Mod is saved in the <strong>mods folder within the application installation directory</strong>, you can directly launch the application to debug your Mod",

    // ===== Live2D Mod =====
    tut_section_live2d: "🎭 How to Quickly Create a Live2D Mod",
    tut_l2d_import_assets: "Import Assets",
    tut_l2d_open_anim_desc: "Open the Mod Editor and select the <strong>Animation</strong> tab",
    tut_l2d_import_folder_desc: "Click the <strong>Import Folder</strong> button in the top toolbar, select your live2d files, <strong>make sure model3.json is directly under that directory</strong>, and wait for the import success notification to appear in the bottom-right corner",
    tut_l2d_sync_config_desc: "Click the <strong>Sync Config from File</strong> button in the top toolbar, and check whether the content under <strong>Model Config (live2d.json - model)</strong> is correct. If not, please fill it in manually",
    tut_l2d_sync_assets_desc: "Click the <strong>Sync Assets from File</strong> button in the top toolbar, and check whether the content under <strong>Expressions List (expressions) / Motions List (motions) / Background/Overlay Layers (background_layers) / State-Animation Mapping (states)</strong> is correct",
    tut_l2d_edit_states_desc: "Of course, you can also edit the state mapping yourself — remove unnecessary states or map motions and expressions into the same state as needed",
    tut_l2d_gen_input_desc: "Click the <strong>Generate Input Events from File</strong> button in the top toolbar to generate input events based on the parameters configured in the live2d file",
    tut_l2d_bongocat_desc: 'If your live2d is BongoCat, the configuration ends here. Please proceed to the next step: <a href="#states-triggers">States and Triggers</a>. If not, please continue reading the following content',
    tut_l2d_add_states: "Add States",
    tut_l2d_add_states_desc: "Once the content under <strong>State-Animation Mapping (states)</strong> is correct, you can click the <strong>Add State with Same Name</strong> button for each item to create the corresponding state. However, in this tutorial we only create an <strong>idle</strong> state. Handling other states will be covered in future tutorials",
    tut_l2d_go_states_desc: "After all mappings are complete, select the <strong>States and Triggers</strong> tab",
    tut_l2d_edit_idle_desc: "Expand the <strong>Core States</strong> category, and click the <strong>Edit</strong> button for the <strong>idle</strong> state",
    tut_l2d_assoc_anim_desc: "In the opened window, find the <strong>Associated Animation</strong> dropdown menu, select your animation, and click Save",
    tut_l2d_done_desc: "You have now completed the creation of a basic live2d Mod. Don't forget to click <strong>Save</strong> to save your changes to your folder",
    tut_l2d_debug_desc: "After that, if your Mod is saved in the <strong>mods folder within the application installation directory</strong>, you can directly launch the application to debug your Mod",

    // ===== PngRemix Mod =====
    tut_section_pngremix: "🧩 How to Quickly Create a PngRemix Mod",
    tut_pr_import_assets: "Import Assets",
    tut_pr_open_anim_desc: "Open the Mod Editor and select the <strong>Animation</strong> tab",
    tut_pr_import_file_desc: "Click the <strong>Import File</strong> button in the top toolbar, select your pngremix file, and wait for the import success notification to appear in the bottom-right corner",
    tut_pr_sync_config_desc: "Click the <strong>Sync Config from File</strong> button in the top toolbar, and check whether the content under <strong>Model Config (pngremix.json - model)</strong> is correct. If not, please fill it in manually",
    tut_pr_sync_assets_desc: "Click the <strong>Sync Assets from File</strong> button in the top toolbar, and check whether the content under <strong>Expressions List (expressions) / Motions List (motions) / State Mapping (states)</strong> is correct",
    tut_pr_edit_states_desc: "Of course, you can also edit the state mapping yourself — remove unnecessary states or map motions and expressions into the same state as needed",
    tut_pr_add_states: "Add States",
    tut_pr_add_states_desc: "Once the content under <strong>State Mapping (states)</strong> is correct, you can click the <strong>Add State with Same Name</strong> button for each item to create the corresponding state. However, in this tutorial we only create an <strong>idle</strong> state. Handling other states will be covered in future tutorials",
    tut_pr_go_states_desc: "After all mappings are complete, select the <strong>States and Triggers</strong> tab",
    tut_pr_edit_idle_desc: "Expand the <strong>Core States</strong> category, and click the <strong>Edit</strong> button for the <strong>idle</strong> state",
    tut_pr_assoc_anim_desc: "In the opened window, find the <strong>Associated Animation</strong> dropdown menu, select your animation, and click Save",
    tut_pr_done_desc: "You have now completed the creation of a basic PngRemix Mod. Don't forget to click <strong>Save</strong> to save your changes to your folder",
    tut_pr_debug_desc: "After that, if your Mod is saved in the <strong>mods folder within the application installation directory</strong>, you can directly launch the application to debug your Mod",

    // ===== States and Triggers =====
    tut_section_states_triggers: "🎭 States and Triggers",
    tut_st_states: "States",
    tut_st_intro_desc: "This application is essentially a finite state machine — states and triggers are its core.",
    tut_st_categories_desc: "States are divided into 3 categories: <strong>Core States</strong>, <strong>Important States</strong>, and <strong>Normal States</strong>",
    tut_st_core_desc: "Core states and important states cannot be added or deleted — they are hardcoded by the system. Normal states can be freely added and deleted.",
    tut_st_bind_desc: "All three categories share the same configuration. Each state can bind <strong>Associated Audio</strong>, <strong>Associated Animation</strong>, and <strong>Associated Text</strong>",
    tut_st_dropdown_desc: "After adding content in <strong>Multilingual Text</strong>, <strong>Multilingual Audio</strong>, or <strong>Animation</strong> panels, you can use the dropdown menus to bind the added content to a state",
    tut_st_triggers: "Triggers",
    tut_st_triggers_intro_desc: "Once states are defined, different triggers cause the application to execute the corresponding states",
    tut_st_triggers_types_desc: "You can find all currently supported trigger types at the bottom of the States and Triggers panel",
    tut_st_click_intro_desc: "Here we introduce the most common one: <strong>Mouse Click</strong>",
    tut_st_click_desc: "You can find the <strong>click</strong> event under the <strong>Triggers (Event Response)</strong> category — it corresponds to left-clicking the character widget. Click to edit this event",
    tut_st_add_group_desc: "Click the <strong>Add State Group</strong> button",
    tut_st_skip_select_desc: 'Ignore the "Select State" dropdown — leaving the persistent state empty means this can be triggered under any persistent state. Click the <strong>Add State</strong> button directly',
    tut_st_select_state_desc: "Select a state from the dropdown in the newly added entry to add it to the list of click-triggerable states, then click Save",
    tut_st_result_desc: "Now when you click your pet, it will play the new animation, audio, and text",
    tut_st_save_reminder_desc: "Don't forget to click <strong>Save</strong> to save changes to your folder",
    tut_st_debug_desc: "If your Mod is saved in the <strong>mods folder inside the application installation directory</strong>, you can launch the application directly to debug your Mod",
    tut_more_coming_title: "💡 Tip",
    tut_more_coming_desc: "<strong>More content coming in future updates</strong>",

    // ===== Image paths =====
    tut_img_new1: "imgs/en/tutorial_new1.png",
    tut_img_new3: "imgs/en/tutorial_new3.png",
    tut_img_new4: "imgs/en/tutorial_new4.png",
    tut_img_newmod: "imgs/en/newmod.png",
    tut_img_new5: "imgs/en/tutorial_new5.png",
    tut_img_new6: "imgs/en/tutorial_new6.png",
    tut_img_seq1: "imgs/en/tutorial_sequence1.png",
    tut_img_seq3: "imgs/en/tutorial_sequence3.png",
    tut_img_seq4: "imgs/en/tutorial_sequence4.png",
    tut_img_seq6: "imgs/en/tutorial_sequence6.png",
    tut_img_seq7: "imgs/en/tutorial_sequence7.png",
    tut_img_seq8: "imgs/en/tutorial_sequence8.png",
    tut_img_seq9: "imgs/en/tutorial_sequence9.png",
    tut_img_l2d1: "imgs/en/tutorial_live2d1.png",
    tut_img_l2d2: "imgs/en/tutorial_live2d2.png",
    tut_img_l2d3: "imgs/en/tutorial_live2d3.png",
    tut_img_l2d4: "imgs/en/tutorial_live2d4.png",
    tut_img_pr1: "imgs/en/tutorial_pngremix1.png",
    tut_img_pr2: "imgs/en/tutorial_pngremix2.png",
    tut_img_pr3: "imgs/en/tutorial_pngremix3.png",
    tut_img_pr4: "imgs/en/tutorial_pngremix4.png",
    tut_img_st1: "imgs/en/states_triggers1.png",
    tut_img_st2: "imgs/en/states_triggers2.png",
    tut_img_st3: "imgs/en/states_triggers3.png",
    tut_img_st4: "imgs/en/states_triggers4.png",
    tut_img_st5: "imgs/en/states_triggers5.png",
    tut_img_st6: "imgs/en/states_triggers6.png",
    tut_img_st7: "imgs/en/states_triggers7.png",
  },

  ja: {
    tutorial_title: "TrayBuddy Mod チュートリアル",
    nav_brand: "TrayBuddy Mod Editor",
    footer_copyright: "TrayBuddy Mod Editor © 2024",
    back_to_editor: "エディターに戻る",
    lang_zh: "中文",
    lang_en: "EN",
    lang_ja: "JA",
    sidebar_toc: "目次",

    // TOC
    tut_toc_new_mod: "新しいModの作成方法",
    tut_toc_sequence: "シーケンスフレーム Mod",
    tut_toc_live2d: "Live2D Mod",
    tut_toc_pngremix: "PngRemix Mod",
    tut_toc_states_triggers: "ステートとトリガー",

    // Page header
    tut_page_title: "📚 Mod 作成チュートリアル",
    tut_page_lead: "このチュートリアルでは、シーケンスフレーム、Live2D、PngRemix など、さまざまなタイプの Mod の作成方法をステップバイステップで説明します。",
    tut_warning_title: "⚠️ 注意",
    tut_warning_desc: '本プロジェクトはまだ初期段階です。ご不明な点がございましたら、お気軽にお問い合わせください。QQ群：<a href="imgs/QQ群.jpg" target="_blank" rel="noopener noreferrer">578258773</a> &nbsp; Bilibili: <a href="https://b23.tv/ZKVKHH0" target="_blank" rel="noopener noreferrer">_Cafel_</a>',

    // ===== 新しいModの作成方法 =====
    tut_section_new_mod: "📦 新しいModの作成方法",
    tut_open_editor: "Modエディターを開く",
    tut_open_editor_desc: "アプリケーションをインストールして起動した後、トレイアイコンまたはキャラクターウィジェットを右クリックしてコンテキストメニューを開き、<strong>Modエディター</strong> を選択してください。",
    tut_open_bat_desc: "フォルダーが開きます。<strong>打开-mod编辑器.bat</strong> をダブルクリックしてください",
    tut_browser_open_desc: "Webブラウザで新しいウィンドウが起動します。これがModエディターです",
    tut_create_mod: "新しいModを作成する",
    tut_create_mod_desc: "Modエディターを開いた後、右上の <strong>新規Mod</strong> ボタンをクリックしてください",
    tut_fill_info_desc: "ポップアップウィンドウで基本情報を入力し、アニメーションタイプに応じたModタイプを選択して、<strong>作成</strong> をクリックしてください",
    tut_save_first_desc: "作成完了後、まだローカルにファイルが作成されていないことにご注意ください。まず右上の <strong>保存</strong> をクリックしてフォルダーを選択することをお勧めします",
    tut_tip_save_title: "💡 ヒント",
    tut_tip_save_desc: "Modの保存先を <strong>アプリケーションインストールディレクトリ内のmodsフォルダ</strong> に設定することをお勧めします。こうすることで、プログラム起動時に追加操作なしで新しいModを直接ロードできます",
    tut_save_success_desc: "システムの右下に <strong>保存成功</strong> の通知が表示されたら、関連ファイルが対象フォルダーに保存されています",
    tut_start_creating: "これでModの制作を開始できます",

    // ===== シーケンスフレーム Mod =====
    tut_section_sequence: "🎬️ シーケンスフレームModの簡単な作成方法",
    tut_seq_process_anim: "アニメーションの処理",
    tut_seq_open_tools_desc: "アプリケーションをインストールして起動した後、トレイアイコンまたはキャラクターウィジェットを右クリックしてコンテキストメニューを開き、<strong>その他のツール</strong> を選択してください",
    tut_seq_toolchain_desc: "フォルダーが開き、TrayBuddyが提供するツールチェーンが表示されます",
    tut_seq_convert_desc: "元の素材が <strong>GIF / 動画 / 差分PNGセット</strong> のいずれであっても、ツールチェーン内のツールを使用してSpriteSheetに変換できます",
    tut_seq_table_tool: "ツール",
    tut_seq_table_function: "機能",
    tut_seq_tool_gif: "GIF フレーム抽出",
    tut_seq_tool_gif_desc: "GIFアニメーションからフレームシーケンスを抽出",
    tut_seq_tool_video: "動画フレーム抽出",
    tut_seq_tool_video_desc: "動画ファイルからフレームシーケンスを抽出",
    tut_seq_tool_gen: "Spritesheet 生成",
    tut_seq_tool_gen_desc: "差分画像をスプライトシートに結合",
    tut_seq_tool_split: "Spritesheet 分割",
    tut_seq_tool_split_desc: "スプライトシートを個別フレームに分割",
    tut_seq_tool_compress: "Spritesheet 圧縮",
    tut_seq_tool_compress_desc: "スプライトシートのファイルサイズ最適化",
    tut_seq_tool_preview: "シーケンスフレームプレビュー",
    tut_seq_tool_preview_desc: "差分画像 / SpriteSheet のアニメーション効果をプレビュー",
    tut_seq_tool_align: "シーケンスフレーム位置合わせツール",
    tut_seq_tool_align_desc: "フレームの位置合わせとオフセット調整",
    tut_seq_tool_batch: "一括トリミング＆リサイズ",
    tut_seq_tool_batch_desc: "一括画像処理",
    tut_seq_add_anim: "アニメーションの追加",
    tut_seq_add_anim_desc: "最初のSpriteSheetが準備できたら、Modエディターに戻り、<strong>アニメーション</strong> タブを選択してください",
    tut_seq_import_desc: "<strong>シーケンスフレームアニメーション (sequence.json)</strong> の右側にある <strong>インポート</strong> ボタンをクリックしてください",
    tut_seq_edit_desc: "SpriteSheetを選択すると、エディターがインポートして新しいアニメーションを生成します。次に <strong>編集</strong> ボタンをクリックしてください",
    tut_seq_frame_desc: "SpriteSheetに基づいて、<strong>横方向のフレーム数と縦方向のフレーム数</strong> を入力してください。入力が正しければ、フレーム幅とフレーム高さが自動的に計算されます。確認後、<strong>保存</strong> をクリックしてください",
    tut_seq_add_state: "ステートの追加",
    tut_seq_add_state_desc: "最初のアニメーションが準備できたら、<strong>ステートとトリガー</strong> タブを選択してください",
    tut_seq_edit_idle_desc: "<strong>コアステート</strong> カテゴリを展開し、<strong>idle</strong> ステートの <strong>編集</strong> ボタンをクリックしてください",
    tut_seq_assoc_anim_desc: "開いたウィンドウで、<strong>関連アニメーション</strong> ドロップダウンメニューを見つけ、先ほどのアニメーションを選択して、保存をクリックしてください",
    tut_seq_done_desc: "これで最も基本的なシーケンスフレームModの作成が完了です。<strong>保存</strong> をクリックして変更をフォルダーに保存することをお忘れなく",
    tut_seq_debug_desc: "その後、Modが <strong>アプリケーションインストールディレクトリ内のmodsフォルダ</strong> に保存されている場合、直接アプリケーションを起動してModをデバッグできます",

    // ===== Live2D Mod =====
    tut_section_live2d: "🎭 live2d Modの簡単な作成方法",
    tut_l2d_import_assets: "アセットのインポート",
    tut_l2d_open_anim_desc: "Modエディターを開き、<strong>アニメーション</strong> タブを選択してください",
    tut_l2d_import_folder_desc: "上部ツールバーの <strong>フォルダーをインポート</strong> ボタンをクリックし、live2dファイルを選択してください。<strong>model3.jsonがそのディレクトリ直下にあることを確認してください</strong>。右下にインポート成功の通知が表示されるまでお待ちください",
    tut_l2d_sync_config_desc: "上部ツールバーの <strong>ファイルから設定を同期</strong> ボタンをクリックし、<strong>モデル設定 (live2d.json - model)</strong> カテゴリの内容が正しいか確認してください。正しくない場合は手動で補完してください",
    tut_l2d_sync_assets_desc: "上部ツールバーの <strong>ファイルからアセットを同期</strong> ボタンをクリックし、<strong>表情リスト (expressions) / モーションリスト (motions) / 背景/オーバーレイレイヤー (background_layers) / ステート-アニメーションマッピング (states)</strong> カテゴリの内容が正しいか確認してください",
    tut_l2d_edit_states_desc: "もちろん、ステートマッピングを自分で編集することもできます。必要に応じて不要なステートを削除したり、モーションと表情を同じステートにマッピングしたりできます",
    tut_l2d_gen_input_desc: "上部ツールバーの <strong>ファイルから入力イベントを生成</strong> ボタンをクリックし、live2dファイル内に設定されたパラメータに基づいて入力イベントを生成してください",
    tut_l2d_bongocat_desc: 'お使いのlive2dがBongoCatの場合、設定はここで終了です。次のステップに進んでください：<a href="#states-triggers">ステートとトリガー</a>。そうでない場合は、以下の内容を引き続きご覧ください',
    tut_l2d_add_states: "ステートの追加",
    tut_l2d_add_states_desc: "<strong>ステート-アニメーションマッピング (states)</strong> カテゴリの内容が正しければ、各項目の <strong>同名ステートを追加</strong> ボタンをクリックして対応するステートを作成できます。ただし、このチュートリアルでは <strong>idle</strong> ステートのみを作成します。他のステートの処理は今後のチュートリアルで説明します",
    tut_l2d_go_states_desc: "すべてのマッピングが完了したら、<strong>ステートとトリガー</strong> タブを選択してください",
    tut_l2d_edit_idle_desc: "<strong>コアステート</strong> カテゴリを展開し、<strong>idle</strong> ステートの <strong>編集</strong> ボタンをクリックしてください",
    tut_l2d_assoc_anim_desc: "開いたウィンドウで、<strong>関連アニメーション</strong> ドロップダウンメニューを見つけ、先ほどのアニメーションを選択して、保存をクリックしてください",
    tut_l2d_done_desc: "これで最も基本的なlive2d Modの作成が完了です。<strong>保存</strong> をクリックして変更をフォルダーに保存することをお忘れなく",
    tut_l2d_debug_desc: "その後、Modが <strong>アプリケーションインストールディレクトリ内のmodsフォルダ</strong> に保存されている場合、直接アプリケーションを起動してModをデバッグできます",

    // ===== PngRemix Mod =====
    tut_section_pngremix: "🧩 PngRemix Modの簡単な作成方法",
    tut_pr_import_assets: "アセットのインポート",
    tut_pr_open_anim_desc: "Modエディターを開き、<strong>アニメーション</strong> タブを選択してください",
    tut_pr_import_file_desc: "上部ツールバーの <strong>ファイルをインポート</strong> ボタンをクリックし、pngremixファイルを選択して、右下にインポート成功の通知が表示されるまでお待ちください",
    tut_pr_sync_config_desc: "上部ツールバーの <strong>ファイルから設定を同期</strong> ボタンをクリックし、<strong>モデル設定 (pngremix.json - model)</strong> カテゴリの内容が正しいか確認してください。正しくない場合は手動で補完してください",
    tut_pr_sync_assets_desc: "上部ツールバーの <strong>ファイルからアセットを同期</strong> ボタンをクリックし、<strong>表情リスト (expressions) / モーションリスト (motions) / ステートマッピング (states)</strong> カテゴリの内容が正しいか確認してください",
    tut_pr_edit_states_desc: "もちろん、ステートマッピングを自分で編集することもできます。必要に応じて不要なステートを削除したり、モーションと表情を同じステートにマッピングしたりできます",
    tut_pr_add_states: "ステートの追加",
    tut_pr_add_states_desc: "<strong>ステートマッピング (states)</strong> カテゴリの内容が正しければ、各項目の <strong>同名ステートを追加</strong> ボタンをクリックして対応するステートを作成できます。ただし、このチュートリアルでは <strong>idle</strong> ステートのみを作成します。他のステートの処理は今後のチュートリアルで説明します",
    tut_pr_go_states_desc: "すべてのマッピングが完了したら、<strong>ステートとトリガー</strong> タブを選択してください",
    tut_pr_edit_idle_desc: "<strong>コアステート</strong> カテゴリを展開し、<strong>idle</strong> ステートの <strong>編集</strong> ボタンをクリックしてください",
    tut_pr_assoc_anim_desc: "開いたウィンドウで、<strong>関連アニメーション</strong> ドロップダウンメニューを見つけ、先ほどのアニメーションを選択して、保存をクリックしてください",
    tut_pr_done_desc: "これで最も基本的なPngRemix Modの作成が完了です。<strong>保存</strong> をクリックして変更をフォルダーに保存することをお忘れなく",
    tut_pr_debug_desc: "その後、Modが <strong>アプリケーションインストールディレクトリ内のmodsフォルダ</strong> に保存されている場合、直接アプリケーションを起動してModをデバッグできます",

    // ===== ステートとトリガー =====
    tut_section_states_triggers: "🎭 状態とトリガー",
    tut_st_states: "状態",
    tut_st_intro_desc: "本アプリケーションは基本的に有限状態マシンであり、状態とトリガーがその中核です",
    tut_st_categories_desc: "状態は <strong>コア状態</strong>、<strong>重要状態</strong>、<strong>通常状態</strong> の3種に分かれます",
    tut_st_core_desc: "コア状態と重要状態は追加・削除できません（システムで固定）。通常状態は自由に追加・削除できます。",
    tut_st_bind_desc: "3種の状態の設定は共通です。各状態には <strong>関連音声</strong>、<strong>関連アニメーション</strong>、<strong>関連テキスト</strong> をバインドできます",
    tut_st_dropdown_desc: "<strong>多言語テキスト</strong>、<strong>多言語音声</strong>、<strong>アニメーション</strong> パネルでコンテンツを追加すると、ドロップダウンメニューから追加したコンテンツを状態にバインドできます",
    tut_st_triggers: "トリガー",
    tut_st_triggers_intro_desc: "状態が定義されると、さまざまなトリガーによってアプリケーションが対応する状態を実行します",
    tut_st_triggers_types_desc: "状態とトリガー画面の最下部で、現在サポートされているすべてのトリガータイプを確認できます",
    tut_st_click_intro_desc: "ここでは最も一般的な <strong>マウスクリック</strong> を紹介します",
    tut_st_click_desc: "<strong>トリガー（イベント応答）</strong> カテゴリ内の <strong>click</strong> イベントを見つけてください。これはキャラクターウィジェットの左クリックに対応します。クリックしてイベントを編集します",
    tut_st_add_group_desc: "<strong>状態グループを追加</strong> ボタンをクリックしてください",
    tut_st_skip_select_desc: "「状態を選択」ドロップダウンは無視してください。永続状態を空にすると、どの永続状態でもトリガーできます。直接 <strong>状態を追加</strong> ボタンをクリックしてください",
    tut_st_select_state_desc: "新しく追加された項目のドロップダウンから状態を選択すると、クリックでトリガー可能な状態リストに追加されます。その後、保存をクリックしてください",
    tut_st_result_desc: "これで、ペットをクリックすると新しいアニメーション、音声、テキストが再生されるようになります",
    tut_st_save_reminder_desc: "<strong>保存</strong> をクリックして変更をフォルダに保存することを忘れないでください",
    tut_st_debug_desc: "Mod が <strong>アプリケーションのインストールディレクトリ内の mods フォルダ</strong> に保存されている場合、アプリケーションを直接起動して Mod をデバッグできます",
    tut_more_coming_title: "💡 ヒント",
    tut_more_coming_desc: "<strong>今後のアップデートでさらにコンテンツを追加予定</strong>",

    // ===== Image paths =====
    tut_img_new1: "imgs/jp/tutorial_new1.png",
    tut_img_new3: "imgs/jp/tutorial_new3.png",
    tut_img_new4: "imgs/jp/tutorial_new4.png",
    tut_img_newmod: "imgs/jp/newmod.png",
    tut_img_new5: "imgs/jp/tutorial_new5.png",
    tut_img_new6: "imgs/jp/tutorial_new6.png",
    tut_img_seq1: "imgs/jp/tutorial_sequence1.png",
    tut_img_seq3: "imgs/jp/tutorial_sequence3.png",
    tut_img_seq4: "imgs/jp/tutorial_sequence4.png",
    tut_img_seq6: "imgs/jp/tutorial_sequence6.png",
    tut_img_seq7: "imgs/jp/tutorial_sequence7.png",
    tut_img_seq8: "imgs/jp/tutorial_sequence8.png",
    tut_img_seq9: "imgs/jp/tutorial_sequence9.png",
    tut_img_l2d1: "imgs/jp/tutorial_live2d1.png",
    tut_img_l2d2: "imgs/jp/tutorial_live2d2.png",
    tut_img_l2d3: "imgs/jp/tutorial_live2d3.png",
    tut_img_l2d4: "imgs/jp/tutorial_live2d4.png",
    tut_img_pr1: "imgs/jp/tutorial_pngremix1.png",
    tut_img_pr2: "imgs/jp/tutorial_pngremix2.png",
    tut_img_pr3: "imgs/jp/tutorial_pngremix3.png",
    tut_img_pr4: "imgs/jp/tutorial_pngremix4.png",
    tut_img_st1: "imgs/jp/states_triggers1.png",
    tut_img_st2: "imgs/jp/states_triggers2.png",
    tut_img_st3: "imgs/jp/states_triggers3.png",
    tut_img_st4: "imgs/jp/states_triggers4.png",
    tut_img_st5: "imgs/jp/states_triggers5.png",
    tut_img_st6: "imgs/jp/states_triggers6.png",
    tut_img_st7: "imgs/jp/states_triggers7.png",
  }
};

// i18n system
const tutorialI18n = {
  currentLang: 'zh',

  t(key) {
    return tutorialTranslations[this.currentLang]?.[key] || tutorialTranslations.zh[key] || key;
  },

  updateDOM() {
    // Update text content
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      const text = this.t(key);
      if (el.tagName === 'TITLE') {
        document.title = text;
      } else if (text.includes('<')) {
        el.innerHTML = text;
      } else {
        el.textContent = text;
      }
    });

    // Update image src based on language
    document.querySelectorAll('[data-i18n-src]').forEach(img => {
      const key = img.getAttribute('data-i18n-src');
      const src = this.t(key);
      if (src && src !== key) {
        img.setAttribute('src', src);
      }
    });

    // Update active button
    document.querySelectorAll('.lang-btn').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-lang') === this.currentLang);
    });
  },

  setLanguage(lang) {
    if (tutorialTranslations[lang]) {
      this.currentLang = lang;
      try { localStorage.setItem('tutorial-lang', lang); } catch(e) {}
      this.updateDOM();
    }
  },

  init() {
    // Get stored or browser language
    let lang = 'zh';
    try { lang = localStorage.getItem('tutorial-lang'); } catch(e) {}
    if (!lang) {
      const browserLang = (navigator.language || 'zh').toLowerCase();
      if (browserLang.startsWith('en')) lang = 'en';
      else if (browserLang.startsWith('ja')) lang = 'ja';
      else lang = 'zh';
    }

    this.currentLang = lang;
    this.updateDOM();

    // Bind language buttons
    document.querySelectorAll('.lang-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.setLanguage(btn.getAttribute('data-lang'));
      });
    });
  }
};

// Initialize on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => tutorialI18n.init());
} else {
  tutorialI18n.init();
}

// Section observer for sidebar highlighting
const tutObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      const id = entry.target.id;
      document.querySelectorAll('.sidebar-nav a').forEach(a => {
        a.classList.toggle('active', a.getAttribute('href') === `#${id}`);
      });
    }
  });
}, { rootMargin: '-80px 0px -80% 0px' });

document.querySelectorAll('section[id]').forEach(section => {
  tutObserver.observe(section);
});
