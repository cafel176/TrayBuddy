// ResourceManager 运行时方法（依赖 tauri::AppHandle，无法单元测试）
// 通过 include!() 包含在 resource.rs 中
//
// 包含：
// - `new()` - 需要 AppHandle 发现 Mod 路径
// - `discover_mod_paths()` - 依赖 AppHandle 获取配置/资源目录

impl ResourceManager {
    /// 创建资源管理器
    pub fn new(app_handle: &tauri::AppHandle) -> Self {
        Self::new_with_search_paths(Self::discover_mod_paths(app_handle))
    }

    /// 发现所有可能的 Mod 搜索路径
    ///
    /// 搜索优先级：配置目录 → 资源目录 → 程序目录 → 工作目录。
    /// Debug 模式下会额外加入 `mods_test` 目录用于开发测试。
    fn discover_mod_paths(app_handle: &tauri::AppHandle) -> Vec<PathBuf> {
        use tauri::Manager;

        let mut paths = Vec::with_capacity(4);

        // 1. 应用配置目录下的 mods（用户自定义 Mod）
        if let Ok(config_dir) = app_handle.path().app_config_dir() {
            let mods_path = config_dir.join("mods");
            if let Ok(canonical) = dunce::canonicalize(&mods_path) {
                #[cfg(debug_assertions)]
                println!("[ResourceManager] 配置目录 mods: {:?}", canonical);
                if canonical.is_dir() {
                    paths.push(canonical);
                }
            }
        }

        // 2. 打包资源目录下的 mods（内置 Mod，Release 打包时包含）
        if let Ok(resource_dir) = app_handle.path().resource_dir() {
            let mods_path = resource_dir.join("mods");
            if let Ok(canonical) = dunce::canonicalize(&mods_path) {
                #[cfg(debug_assertions)]
                println!("[ResourceManager] 资源目录 mods: {:?}", canonical);
                if canonical.is_dir() && !paths.contains(&canonical) {
                    paths.push(canonical);
                }
            }
        }

        // 2.5 mods_test 目录（仅 Debug 模式下加载，用于开发测试）
        if let Ok(resource_dir) = app_handle.path().resource_dir() {
            let mods_path = resource_dir.join("mods_test");
            if let Ok(canonical) = dunce::canonicalize(&mods_path) {
                #[cfg(debug_assertions)]
                println!("[ResourceManager] 资源目录 mods_test: {:?}", canonical);
                if canonical.is_dir() && !paths.contains(&canonical) {
                    paths.push(canonical);
                }
            }
        }

        // 2.5 mods_release 目录（仅 Debug 模式下加载，用于开发测试）
        if let Ok(resource_dir) = app_handle.path().resource_dir() {
            let mods_path = resource_dir.join("mods_release");
            if let Ok(canonical) = dunce::canonicalize(&mods_path) {
                #[cfg(debug_assertions)]
                println!("[ResourceManager] 资源目录 mods_release: {:?}", canonical);
                if canonical.is_dir() && !paths.contains(&canonical) {
                    paths.push(canonical);
                }
            }
        }

        // 2.6 mods_secure 目录（仅 Debug 模式下加载，用于开发测试）
        if let Ok(resource_dir) = app_handle.path().resource_dir() {
            let mods_path = resource_dir.join("mods_secure");
            if let Ok(canonical) = dunce::canonicalize(&mods_path) {
                #[cfg(debug_assertions)]
                println!("[ResourceManager] 资源目录 mods_secure: {:?}", canonical);
                if canonical.is_dir() && !paths.contains(&canonical) {
                    paths.push(canonical);
                }
            }
        }

        // 3. 可执行文件所在目录的 mods
        if let Ok(exe_path) = std::env::current_exe() {
            let mut current_dir = exe_path.parent();
            for level in 1..=crate::modules::constants::MODS_SEARCH_MAX_LEVELS_EXE {
                if let Some(dir) = current_dir {
                    let mods_path = dir.join("mods");
                    if let Ok(canonical) = dunce::canonicalize(&mods_path) {
                        #[cfg(debug_assertions)]
                        println!(
                            "[ResourceManager] 程序目录 mods (level {}): {:?}",
                            level, canonical
                        );
                        if canonical.is_dir() && !paths.contains(&canonical) {
                            paths.push(canonical);
                        }
                    }
                    current_dir = dir.parent();
                } else {
                    break;
                }
            }
        }

        if let Ok(exe_path) = std::env::current_exe() {
            let mut current_dir = exe_path.parent();
            for level in 1..=crate::modules::constants::MODS_SEARCH_MAX_LEVELS_EXE {
                if let Some(dir) = current_dir {
                    let mods_path = dir.join("mods_test");
                    if let Ok(canonical) = dunce::canonicalize(&mods_path) {
                        #[cfg(debug_assertions)]
                        println!(
                            "[ResourceManager] 程序目录 mods_test (level {}): {:?}",
                            level, canonical
                        );
                        if canonical.is_dir() && !paths.contains(&canonical) {
                            paths.push(canonical);
                        }
                    }
                    current_dir = dir.parent();
                } else {
                    break;
                }
            }
        }

        if let Ok(exe_path) = std::env::current_exe() {
            let mut current_dir = exe_path.parent();
            for level in 1..=crate::modules::constants::MODS_SEARCH_MAX_LEVELS_EXE {
                if let Some(dir) = current_dir {
                    let mods_path = dir.join("mods_release");
                    if let Ok(canonical) = dunce::canonicalize(&mods_path) {
                        #[cfg(debug_assertions)]
                        println!(
                            "[ResourceManager] 程序目录 mods_release (level {}): {:?}",
                            level, canonical
                        );
                        if canonical.is_dir() && !paths.contains(&canonical) {
                            paths.push(canonical);
                        }
                    }
                    current_dir = dir.parent();
                } else {
                    break;
                }
            }
        }

        if let Ok(exe_path) = std::env::current_exe() {
            let mut current_dir = exe_path.parent();
            for level in 1..=crate::modules::constants::MODS_SEARCH_MAX_LEVELS_EXE {
                if let Some(dir) = current_dir {
                    let mods_path = dir.join("mods_secure");
                    if let Ok(canonical) = dunce::canonicalize(&mods_path) {
                        #[cfg(debug_assertions)]
                        println!(
                            "[ResourceManager] 程序目录 mods_secure (level {}): {:?}",
                            level, canonical
                        );
                        if canonical.is_dir() && !paths.contains(&canonical) {
                            paths.push(canonical);
                        }
                    }
                    current_dir = dir.parent();
                } else {
                    break;
                }
            }
        }

        // 4. 开发环境：当前工作目录向上查找 mods
        if let Ok(cwd) = std::env::current_dir() {
            let mut current_dir = Some(cwd.as_path());
            for level in 1..=crate::modules::constants::MODS_SEARCH_MAX_LEVELS_CWD {
                if let Some(dir) = current_dir {
                    let mods_path = dir.join("mods");
                    if let Ok(canonical) = dunce::canonicalize(&mods_path) {
                        #[cfg(debug_assertions)]
                        println!(
                            "[ResourceManager] 项目目录 mods (level {}): {:?}",
                            level, canonical
                        );
                        if canonical.is_dir() && !paths.contains(&canonical) {
                            paths.push(canonical);
                        }
                    }
                    current_dir = dir.parent();
                } else {
                    break;
                }
            }
        }

        if let Ok(cwd) = std::env::current_dir() {
            let mut current_dir = Some(cwd.as_path());
            for level in 1..=crate::modules::constants::MODS_SEARCH_MAX_LEVELS_CWD {
                if let Some(dir) = current_dir {
                    let mods_path = dir.join("mods_test");
                    if let Ok(canonical) = dunce::canonicalize(&mods_path) {
                        #[cfg(debug_assertions)]
                        println!(
                            "[ResourceManager] 项目目录 mods_test (level {}): {:?}",
                            level, canonical
                        );
                        if canonical.is_dir() && !paths.contains(&canonical) {
                            paths.push(canonical);
                        }
                    }
                    current_dir = dir.parent();
                } else {
                    break;
                }
            }
        }

        if let Ok(cwd) = std::env::current_dir() {
            let mut current_dir = Some(cwd.as_path());
            for level in 1..=crate::modules::constants::MODS_SEARCH_MAX_LEVELS_CWD {
                if let Some(dir) = current_dir {
                    let mods_path = dir.join("mods_release");
                    if let Ok(canonical) = dunce::canonicalize(&mods_path) {
                        #[cfg(debug_assertions)]
                        println!(
                            "[ResourceManager] 项目目录 mods_release (level {}): {:?}",
                            level, canonical
                        );
                        if canonical.is_dir() && !paths.contains(&canonical) {
                            paths.push(canonical);
                        }
                    }
                    current_dir = dir.parent();
                } else {
                    break;
                }
            }
        }

        if let Ok(cwd) = std::env::current_dir() {
            let mut current_dir = Some(cwd.as_path());
            for level in 1..=crate::modules::constants::MODS_SEARCH_MAX_LEVELS_CWD {
                if let Some(dir) = current_dir {
                    let mods_path = dir.join("mods_secure");
                    if let Ok(canonical) = dunce::canonicalize(&mods_path) {
                        #[cfg(debug_assertions)]
                        println!(
                            "[ResourceManager] 项目目录 mods_secure (level {}): {:?}",
                            level, canonical
                        );
                        if canonical.is_dir() && !paths.contains(&canonical) {
                            paths.push(canonical);
                        }
                    }
                    current_dir = dir.parent();
                } else {
                    break;
                }
            }
        }

        paths
    }
}

// 以下函数依赖 archive store / sbuddy 外部工具，不可单元测试

impl ResourceManager {
    /// 尝试在不完整索引下定位 archive mod（主要处理：`.sbuddy` 文件名 != `manifest.id`）。
    ///
    /// - 扫描阶段我们不会解密 `.sbuddy`，因此可能只能用文件名推断一个"占位 id"。
    /// - 当外部传入的是"真实 manifest.id"（例如启动时从 storage 读取 current_mod），这里会尝试：
    ///   1) 命中内存 cache（上一次解密时写入）
    ///   2) 必要时逐个解密 `.sbuddy` 的 manifest.json，直到找到匹配项（只在确实需要加载该 id 时发生）
    fn try_register_archive_by_real_id(&mut self, target_id: &str) {
        if target_id.is_empty() {
            return;
        }
        if self.mod_index.contains_key(target_id) {
            return;
        }

        // 没有 archive store 时无从注册
        let Some(store_arc) = &self.archive_store else {
            return;
        };

        // 先从 cache 里找：canonical_file -> (id, version, mod_type)
        if let Some((cached_path, (_, ver, _ty))) = self
            .sbuddy_manifest_cache
            .iter()
            .find(|(_, (id, _, _))| id == target_id)
            .map(|(p, v)| (p.clone(), v.clone()))
        {

            if let Ok(mut store) = store_arc.lock() {
                store.register_source(target_id.to_string(), cached_path.clone());
            }

            let folder = cached_path
                .file_name()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_else(|| target_id.to_string());

            self.archive_mod_ids.insert(target_id.to_string());
            self.mod_index.insert(
                target_id.to_string(),
                ModLocator {
                    id: target_id.to_string(),
                    version: ver,
                    folder,
                    path: cached_path,
                },
            );
            return;
        }

        // cache 未命中：尝试遍历 `.sbuddy` 文件解密读取 manifest.json
        if !super::mod_archive::is_sbuddy_supported() {
            return;
        }

        for base in &self.search_paths {
            let Ok(entries) = fs::read_dir(base) else {
                continue;
            };

            for entry in entries.flatten() {
                let p = entry.path();
                if !p.is_file() {
                    continue;
                }
                let is_sbuddy = entry
                    .file_name()
                    .to_string_lossy()
                    .to_lowercase()
                    .ends_with(".sbuddy");
                if !is_sbuddy {
                    continue;
                }

                let canonical_file = dunce::canonicalize(&p).unwrap_or(p);

                // 如果之前已缓存但没匹配到（比如 cache 被部分清空），快速检查一次
                if let Some((id, ver, _ty)) = self.sbuddy_manifest_cache.get(&canonical_file) {
                    if id == target_id {

                        if let Ok(mut store) = store_arc.lock() {
                            store.register_source(target_id.to_string(), canonical_file.clone());
                        }

                        let folder = canonical_file
                            .file_name()
                            .map(|s| s.to_string_lossy().into_owned())
                            .unwrap_or_else(|| target_id.to_string());

                        self.archive_mod_ids.insert(target_id.to_string());
                        self.mod_index.insert(
                            target_id.to_string(),
                            ModLocator {
                                id: target_id.to_string(),
                                version: ver.clone(),
                                folder,
                                path: canonical_file,
                            },
                        );
                        return;
                    }
                    continue;
                }

                // 真正解密（只读 manifest.json）
                let Ok(reader) = super::mod_archive::SbuddyArchiveReader::from_file(&canonical_file) else {
                    continue;
                };

                let Ok(m) = reader.read_json::<ModManifest>("manifest.json") else {
                    continue;
                };

                let real_id = m.id.to_string();
                let real_ver = m.version.to_string();

                // 写入 cache，后续 rebuild_mod_index / fast summaries 可直接使用
                self.sbuddy_manifest_cache.insert(
                    canonical_file.clone(),
                    (real_id.clone(), real_ver.clone(), m.mod_type),
                );


                if real_id != target_id {
                    continue;
                }

                if let Ok(mut store) = store_arc.lock() {
                    store.register_source(target_id.to_string(), canonical_file.clone());
                }

                let folder = canonical_file
                    .file_name()
                    .map(|s| s.to_string_lossy().into_owned())
                    .unwrap_or_else(|| target_id.to_string());

                self.archive_mod_ids.insert(target_id.to_string());
                self.mod_index.insert(
                    target_id.to_string(),
                    ModLocator {
                        id: target_id.to_string(),
                        version: real_ver,
                        folder,
                        path: canonical_file,
                    },
                );
                return;
            }
        }
    }

    /// 从磁盘读取 Mod 信息（不加载到当前状态）
    ///
    /// 用于 Mod 预览或加载前的检查。
    /// 自动判断是文件夹 mod 还是 archive mod。
    pub fn read_mod_from_disk(&mut self, mod_id: &str) -> Result<ModInfo, String> {
        // 每次读取前刷新索引，确保 archive_mod_ids / sources 是最新的。
        // 这能保证"启动时当前 mod"即使是 `.tbuddy/.sbuddy` 也会正确走到 archive 解密/读取逻辑。
        self.rebuild_mod_index();

        // 若扫描阶段只用文件名推断（`.sbuddy`），这里兜底尝试定位真实 manifest.id。
        if !self.mod_index.contains_key(mod_id) {
            self.try_register_archive_by_real_id(mod_id);
        }

        // 先检查是否为 archive mod
        if self.is_archive_mod(mod_id) {
            return self.read_mod_from_archive(mod_id);
        }



        // 查找 Mod 目录（优先使用 manifest.id 解析）
        let mod_path = self
            .resolve_mod_path(mod_id)
            .ok_or_else(|| format!("Mod '{}' not found", mod_id))?;

        self.read_mod_from_path(mod_path)
    }

    /// 从 archive 读取 Mod 信息
    ///
    /// - 使用 ModArchiveReader 读取虚拟目录结构
    /// - 返回的 `path` 使用 `tbuddy-archive://{manifest.id}`（真实 id）供前端识别
    /// - 若扫描阶段只能用文件名推断 id（`.sbuddy`），这里会在解密后把真实 id 反哺到内存 cache 与 archive store
    fn read_mod_from_archive(&mut self, requested_id: &str) -> Result<ModInfo, String> {

        let store_arc = self
            .archive_store
            .as_ref()
            .ok_or_else(|| "Archive store not initialized".to_string())?;
        let mut store = store_arc.lock().unwrap();

        // requested_id 可能是扫描阶段推断出来的"占位 id"，此处 ensure_loaded 会按需加载（.sbuddy 会触发解密）
        let reader = store
            .get(requested_id)
            .ok_or_else(|| format!("Archive for mod '{}' not loaded", requested_id))?;

        // 记录来源路径，供后续 cache
        let source_path = store.get_source(requested_id).map(|s| s.file_path.clone());

        // 解析 manifest.json
        let manifest: ModManifest = reader
            .read_json("manifest.json")
            .map_err(|e| format!("Failed to parse manifest from archive: {}", e))?;

        let actual_id = manifest.id.to_string();

        // `.sbuddy`/`.tbuddy`：解密/读取到 manifest 后，把真实 id/版本/类型缓存起来，后续 rebuild_mod_index/fast summaries 可直接使用
        if let Some(p) = source_path {
            let canonical = dunce::canonicalize(&p).unwrap_or(p);
            self.sbuddy_manifest_cache.insert(
                canonical,
                (
                    actual_id.clone(),
                    manifest.version.to_string(),
                    manifest.mod_type,
                ),
            );
        }


        // 如果真实 id 与 requested_id 不一致：
        // - alias 到 archive_store，确保 tbuddy-asset 协议与 get_tbuddy_source_path 均可使用真实 id
        // - 同时在当前 session 中把真实 id 标记为 archive mod
        if !actual_id.is_empty() && actual_id != requested_id {
            store.alias_mod_id(requested_id, &actual_id);
            self.archive_mod_ids.insert(actual_id.clone());
        }


        // 解析资产定义
        let imgs: Vec<AssetInfo> = reader.read_json_list("asset/img.json");
        let sequences: Vec<AssetInfo> = reader.read_json_list("asset/sequence.json");
        let live2d: Option<Live2DConfig> = if manifest.mod_type == ModType::Live2d {
            reader.read_json_optional("asset/live2d.json")
        } else {
            None
        };
        let pngremix: Option<PngRemixConfig> = if manifest.mod_type == ModType::Pngremix {
            reader.read_json_optional("asset/pngremix.json")
        } else {
            None
        };
        let threed: Option<ThreeDConfig> = if manifest.mod_type == ModType::ThreeD {
            reader.read_json_optional("asset/3d.json")
        } else {
            None
        };

        // 解析多语言语音
        let mut audios: HashMap<Box<str>, Vec<AudioInfo>> = HashMap::new();
        for entry in reader.list_dir("audio") {
            if entry.is_dir {
                let lang: Box<str> = entry.path.into();
                let speech: Vec<AudioInfo> =
                    reader.read_json_list(&format!("audio/{}/speech.json", &*lang));
                audios.insert(lang, speech);
            }
        }

        // 解析多语言文本和角色信息
        let mut info: HashMap<Box<str>, CharacterInfo> = HashMap::new();
        let mut texts: HashMap<Box<str>, Vec<TextInfo>> = HashMap::new();
        for entry in reader.list_dir("text") {
            if entry.is_dir {
                let lang: Box<str> = entry.path.clone().into();
                if let Some(mut char_info) =
                    reader.read_json_optional::<CharacterInfo>(&format!("text/{}/info.json", &entry.path))
                {
                    if char_info.id.is_empty() || char_info.id.as_ref() == "ERROR" {
                        char_info.id = lang.clone();
                    }
                    info.insert(lang.clone(), char_info);
                }
                let speech_list: Vec<TextInfo> =
                    reader.read_json_list(&format!("text/{}/speech.json", &entry.path));
                texts.insert(lang, speech_list);
            }
        }

        // 解析气泡样式
        let bubble_style: Option<serde_json::Value> =
            reader.read_json_optional("bubble_style.json");

        // 解析 AI 工具配置（可选）
        let ai_tools: Option<AiToolsConfig> =
            reader.read_json_optional("ai_tools.json");

        // 探测预览图和图标
        let mut icon_path_val = None;
        let mut preview_path_val = None;

        for ext in ["ico", "png"] {
            let p = format!("icon.{}", ext);
            if reader.file_exists(&p) {
                icon_path_val = Some(p);
                break;
            }
        }

        for ext in ["png", "jpg", "jpeg", "webp"] {
            let p = format!("preview.{}", ext);
            if reader.file_exists(&p) {
                preview_path_val = Some(p);
                break;
            }
        }

        // archive mod 的 path 使用特殊标记：tbuddy-archive://{manifest.id}
        // 前端通过此标记判断走 tbuddy-asset:// 协议
        let virtual_path = PathBuf::from(format!("tbuddy-archive://{}", actual_id));


        let mut mod_info = ModInfo {
            path: virtual_path,
            manifest,
            imgs,
            sequences,
            live2d,
            pngremix,
            threed,
            audios,
            info,
            texts,
            bubble_style,
            ai_tools,
            icon_path: icon_path_val.map(|s| s.into()),
            preview_path: preview_path_val.map(|s| s.into()),
            state_index: HashMap::new(),
            trigger_index: HashMap::new(),
            asset_index: HashMap::new(),
            audio_index: HashMap::new(),
            text_index: HashMap::new(),
        };

        mod_info.validate_and_fix_states();
        mod_info.build_indices();

        Ok(mod_info)
    }
}
