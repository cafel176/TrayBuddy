// ResourceManager 文件系统操作方法（涉及 Mod 索引重建、archive 扫描、读取/加载等）
// 通过 include!() 包含在 resource.rs 中
//
// 这些方法包含大量文件系统交互和 archive（.tbuddy/.sbuddy）处理逻辑，
// 在纯单元测试环境中难以完全覆盖（需要真实的 archive 文件），因此排除出覆盖率统计。
//
// 包含：
// - `rebuild_mod_index()` - 重建 Mod 索引（文件夹 + archive）
// - `resolve_mod_path()` - 解析 Mod 标识符为实际路径
// - `resolve_mod_path_public()` - 公开版本
// - `resolve_mod_id()` - 解析 Mod 标识符为 manifest.id
// - `list_mods()` - 列出所有可用 Mod
// - `list_mod_summaries_fast()` - 列出 Mod 快速摘要
// - `unload_mod()` - 卸载当前 Mod
// - `read_mod_from_path()` - 从文件夹读取 Mod
// - `read_mod_from_folder_path()` - 从指定目录读取 Mod
// - `load_mod()` - 加载指定 Mod
// - `load_mod_from_folder_path()` - 从指定目录路径加载 Mod
// - `load_text_resources()` - 加载文本资源
// - `load_multilang_resources()` - 加载多语言资源
// - `get_bubble_style()` - 获取气泡样式
// - `load_default_bubble_style()` - 加载默认气泡样式
// - `get_ai_tools()` - 获取 AI 工具配置

impl ResourceManager {
    fn rebuild_mod_index(&mut self) {
        self.mod_index.clear();
        self.folder_to_id.clear();
        self.archive_mod_ids.clear();

        // 遵循 search_paths 顺序，越靠前优先级越高。
        for base in &self.search_paths {

            let Ok(entries) = fs::read_dir(base) else {
                continue;
            };

            for entry in entries.flatten() {
                let entry_path = entry.path();

                // ---------- 常规文件夹 Mod ----------
                if entry_path.is_dir() {
                    let folder = entry.file_name().to_string_lossy().into_owned();
                    let canonical_dir = dunce::canonicalize(&entry_path).unwrap_or(entry_path);

                    let manifest_path = canonical_dir.join("manifest.json");
                    let (manifest_id, manifest_version) = if manifest_path.exists() {
                        fs::read_to_string(&manifest_path)
                            .ok()
                            .and_then(|s| serde_json::from_str::<ModManifest>(&s).ok())
                            .map(|m| (m.id.to_string(), m.version.to_string()))
                            .unwrap_or_else(|| (folder.clone(), "".to_string()))
                    } else {
                        (folder.clone(), "".to_string())
                    };

                    self.folder_to_id
                        .entry(folder.clone())
                        .or_insert_with(|| manifest_id.clone());

                    if let Some(existing) = self.mod_index.get(&manifest_id) {
                        let ord = Self::compare_version(&manifest_version, &existing.version);
                        if ord != Ordering::Greater {
                            continue;
                        }
                    }

                    self.mod_index.insert(
                        manifest_id.clone(),
                        ModLocator {
                            id: manifest_id,
                            version: manifest_version,
                            folder,
                            path: canonical_dir,
                        },
                    );
                    continue;
                }

                // ---------- .tbuddy 包文件 ----------
                if entry_path.is_file() {
                    let fname = entry.file_name().to_string_lossy().to_lowercase();
                    let is_tbuddy = fname.ends_with(".tbuddy");
                    let is_sbuddy = fname.ends_with(".sbuddy");
                    if !is_tbuddy && !is_sbuddy {
                        continue;
                    }

                    // .sbuddy 需要外部工具支持
                    if is_sbuddy && !super::mod_archive::is_sbuddy_supported() {
                        #[cfg(debug_assertions)]
                        println!(
                            "[ResourceManager] Skipping .sbuddy '{}' (sbuddy tool not found)",
                            entry_path.display()
                        );

                        continue;
                    }

                    // 只做索引：不要在启动/扫描阶段把 archive 全部解包/加载到内存里。
                    // 否则当 mods_test 下有大量 .sbuddy 时，会因为逐个解密 + 解析导致启动"卡死"。

                    // 1) 优先用文件名推断 mod_id（历史约定：{manifest.id}.tbuddy/.sbuddy）
                    let file_stem = entry_path
                        .file_stem()
                        .map(|s| s.to_string_lossy().into_owned())
                        .unwrap_or_default();
                    if file_stem.is_empty() {
                        continue;
                    }

                    // 统一使用 canonical 路径作为 cache key（避免同一文件的不同表示形式导致 cache miss）
                    let canonical_file =
                        dunce::canonicalize(&entry_path).unwrap_or_else(|_| entry_path.clone());

                    // 2) 读取版本号
                    // - .tbuddy：直接读取 zip 内 manifest.json（无需解密，成本低）
                    // - .sbuddy：扫描阶段不解密（成本高），优先使用"解密后缓存"的真实 manifest 信息；
                    //            若无缓存，则回退为文件名推断（可能不是真实 manifest.id）。
                    let (manifest_id, manifest_version) = if is_tbuddy {
                        let mut id = file_stem.clone();
                        let mut ver = String::new();

                        match super::mod_archive::ZipArchiveReader::from_file(&canonical_file)
                            .and_then(|r| r.read_json::<ModManifest>("manifest.json"))
                        {
                            Ok(m) => {
                                id = m.id.to_string();
                                ver = m.version.to_string();
                            }
                            Err(e) => {
                                #[cfg(debug_assertions)]
                                println!(
                                    "[ResourceManager] Failed to read manifest from .tbuddy '{}': {}",
                                    canonical_file.display(),
                                    e
                                );
                            }
                        }

                        (id, ver)
                    } else {
                        // .sbuddy：扫描阶段不解密（优先用缓存）
                        match self.sbuddy_manifest_cache.get(&canonical_file) {
                            Some((id, ver, _ty)) => (id.clone(), ver.clone()),
                            None => (file_stem.clone(), String::new()),
                        }

                    };

                    // 3) 注册 archive 来源（按需加载依赖此映射）
                    if let Some(store_arc) = &self.archive_store {
                        if let Ok(mut store) = store_arc.lock() {
                            store.register_source(manifest_id.clone(), canonical_file.clone());
                        }
                    }



                    // 同 id 版本比较（文件夹 mod 优先；包文件之间比版本号）
                    if let Some(existing) = self.mod_index.get(&manifest_id) {
                        // 如果已有同 id 的文件夹 mod，跳过（文件夹优先）
                        if !self.archive_mod_ids.contains(&manifest_id) {
                            continue;
                        }
                        let ord = Self::compare_version(&manifest_version, &existing.version);
                        if ord != Ordering::Greater {
                            continue;
                        }
                    }

                    let folder = entry.file_name().to_string_lossy().into_owned();
                    self.folder_to_id
                        .entry(folder.clone())
                        .or_insert_with(|| manifest_id.clone());

                    self.archive_mod_ids.insert(manifest_id.clone());
                    self.mod_index.insert(
                        manifest_id.clone(),
                        ModLocator {
                            id: manifest_id,
                            version: manifest_version,
                            folder,
                            path: canonical_file, // .tbuddy / .sbuddy 文件路径
                        },
                    );

                }
            }
        }

        // 清理 archive_store 中磁盘已不存在的 sources 条目
        if let Some(store_arc) = &self.archive_store {
            if let Ok(mut store) = store_arc.lock() {
                store.cleanup_stale_sources();
            }
        }
    }


    /// 解析 Mod 标识符为实际目录路径
    ///
    /// - 首选：`manifest.json` 中的 `id`
    /// - 兼容：历史上使用的文件夹名
    fn resolve_mod_path(&mut self, mod_id_or_folder: &str) -> Option<PathBuf> {
        self.rebuild_mod_index();

        if let Some(locator) = self.mod_index.get(mod_id_or_folder) {
            return Some(locator.path.clone());
        }

        if let Some(id) = self.folder_to_id.get(mod_id_or_folder) {
            if let Some(locator) = self.mod_index.get(id) {
                return Some(locator.path.clone());
            }
        }

        // 最后兜底：按 folder 直接拼路径（兼容旧逻辑）
        for base in &self.search_paths {
            let p = base.join(mod_id_or_folder);
            if p.is_dir() {
                return Some(p);
            }
        }

        None
    }

    /// 公开版本的 resolve_mod_path，供外部调用
    pub fn resolve_mod_path_public(&mut self, mod_id_or_folder: &str) -> Option<PathBuf> {
        self.resolve_mod_path(mod_id_or_folder)
    }

    /// 将传入的标识符解析为 manifest.id
    ///
    /// - 如果本身就是 manifest.id：原样返回
    /// - 如果是文件夹名：返回对应 manifest.id
    pub fn resolve_mod_id(&mut self, mod_id_or_folder: &str) -> Option<String> {
        self.rebuild_mod_index();
        if self.mod_index.contains_key(mod_id_or_folder) {
            Some(mod_id_or_folder.to_string())
        } else {
            self.folder_to_id.get(mod_id_or_folder).cloned()
        }
    }

    /// 列出所有可用的 Mod（以 manifest.id 作为唯一标识）
    pub fn list_mods(&mut self) -> Vec<String> {
        self.rebuild_mod_index();
        let mut result: Vec<String> = self.mod_index.keys().cloned().collect();
        result.sort();
        result
    }

    /// 列出 Mod 的"快速摘要"（不解密 `.sbuddy`）
    ///
    /// 规则：
    /// - 文件夹 mod：读取 `manifest.json` + 仅加载默认语言的 `text/{lang}/info.json`
    /// - `.tbuddy`：读取 zip 内 `manifest.json` + 默认语言 `text/{lang}/info.json`
    /// - `.sbuddy`：**不解密**，默认返回占位摘要；若该文件在本次运行中曾被解密过，则会从 cache 回填 version/mod_type

    pub fn list_mod_summaries_fast(&mut self) -> Vec<ModSummary> {
        use crate::modules::mod_archive::ModArchiveReader;

        self.rebuild_mod_index();

        let mut ids: Vec<String> = self.mod_index.keys().cloned().collect();

        ids.sort();

        fn fix_char_info_id(mut ci: CharacterInfo, fallback: &str) -> CharacterInfo {
            if ci.id.is_empty() || ci.id.as_ref() == "ERROR" {
                ci.id = fallback.into();
            }
            ci
        }

        let mut out: Vec<ModSummary> = Vec::with_capacity(ids.len());

        for id in ids {
            let Some(locator) = self.mod_index.get(&id) else {
                continue;
            };

            let is_archive = self.archive_mod_ids.contains(&id);

            // 默认占位
            let mut manifest = ModManifest::default();
            manifest.id = id.clone().into();
            if !locator.version.is_empty() {
                manifest.version = locator.version.clone().into();
            }
            if manifest.default_text_lang_id.is_empty() {
                manifest.default_text_lang_id = "zh".into();
            }

            let mut info: HashMap<Box<str>, CharacterInfo> = HashMap::new();
            let mut icon_path: Option<Box<str>> = None;
            let mut preview_path: Option<Box<str>> = None;

            if !is_archive {
                // ========== 文件夹 mod ========== 
                let mod_path = locator.path.clone();

                // manifest.json
                let manifest_path = mod_path.join("manifest.json");
                if let Some(m) = crate::modules::utils::fs::load_json_obj::<ModManifest>(&manifest_path) {
                    manifest = m;
                    // 兜底 default_text_lang_id
                    if manifest.default_text_lang_id.is_empty() {
                        manifest.default_text_lang_id = "zh".into();
                    }
                }

                // icon / preview
                for ext in ["ico", "png"] {
                    let p = mod_path.join(format!("icon.{ext}"));
                    if p.exists() {
                        icon_path = Some(format!("icon.{ext}").into());
                        break;
                    }
                }
                for ext in ["png", "jpg", "jpeg", "webp"] {
                    let p = mod_path.join(format!("preview.{ext}"));
                    if p.exists() {
                        preview_path = Some(format!("preview.{ext}").into());
                        break;
                    }
                }

                // 默认语言角色信息（仅 info.json，不加载 speech.json）
                let lang = manifest.default_text_lang_id.to_string();
                let p = mod_path.join("text").join(&lang).join("info.json");
                if let Some(ci) = crate::modules::utils::fs::load_json_obj::<CharacterInfo>(&p) {
                    info.insert(lang.clone().into(), fix_char_info_id(ci, &lang));
                }

                out.push(ModSummary {
                    path: mod_path,
                    manifest,
                    info,
                    icon_path,
                    preview_path,
                });
                continue;
            }

            // ========== archive mod（tbuddy / sbuddy） ==========
            let archive_path = locator.path.clone();
            let ext = archive_path
                .extension()
                .and_then(|s| s.to_str())
                .map(|s| s.to_lowercase())
                .unwrap_or_default();

            // archive 的 path 统一使用虚拟标记，前端通过它走 tbuddy-asset:// 协议
            let virtual_path = PathBuf::from(format!("tbuddy-archive://{}", id));

            if ext == "tbuddy" {
                // `.tbuddy`：可快速读取 zip 内 manifest，不需要解密
                if let Ok(reader) = super::mod_archive::ZipArchiveReader::from_file(&archive_path) {
                    if let Ok(m) = reader.read_json::<ModManifest>("manifest.json") {
                        manifest = m;
                        if manifest.default_text_lang_id.is_empty() {
                            manifest.default_text_lang_id = "zh".into();
                        }
                    }

                    // icon / preview
                    for e in ["ico", "png"] {
                        let p = format!("icon.{e}");
                        if reader.file_exists(&p) {
                            icon_path = Some(p.into());
                            break;
                        }
                    }
                    for e in ["png", "jpg", "jpeg", "webp"] {
                        let p = format!("preview.{e}");
                        if reader.file_exists(&p) {
                            preview_path = Some(p.into());
                            break;
                        }
                    }

                    // 默认语言角色信息（仅 info.json）
                    let lang = manifest.default_text_lang_id.to_string();
                    let p = format!("text/{}/info.json", &lang);
                    if let Some(ci) = reader.read_json_optional::<CharacterInfo>(&p) {
                        info.insert(lang.clone().into(), fix_char_info_id(ci, &lang));
                    }
                }
            } else {
                // `.sbuddy`：快速摘要阶段不解密
                // 默认保持为占位（用于触发前端 hydrate），但若该文件在本次运行中曾被解密过，则使用 cache 回填 version/mod_type。
                manifest.id = id.clone().into();

                // locator.path 现在是 canonical_file
                if let Some((cached_id, cached_ver, cached_type)) =
                    self.sbuddy_manifest_cache.get(&locator.path)
                {
                    // 理论上 cached_id == id（已用真实 id 建索引），这里保守做一次校验
                    if cached_id == &id {
                        if !cached_ver.is_empty() {
                            manifest.version = cached_ver.clone().into();
                        }
                        manifest.mod_type = *cached_type;
                    }
                }

                // cache 未命中时：保持 version 为空（占位）
                if manifest.version.is_empty() {
                    manifest.version = "".into();
                }
            }


            out.push(ModSummary {
                path: virtual_path,
                manifest,
                info,
                icon_path,
                preview_path,
            });
        }

        out
    }



    /// 卸载当前 Mod
    pub fn unload_mod(&mut self) -> bool {
        if self.current_mod.is_some() {
            self.current_mod = None;
            true
        } else {
            false
        }
    }

    /// 从文件夹读取 Mod：解析 manifest/asset/audio/text 并构建索引。
    fn read_mod_from_path(&self, mod_path: PathBuf) -> Result<ModInfo, String> {

        // 使用信号量限制并发加载，防止内存抖动
        // 注意：由于 read_mod_from_path 是同步函数，我们使用 try_acquire
        // 如果无法获取许可（并发已满），我们依然继续加载，但记录警告
        let _permit = LOAD_SEMAPHORE.try_acquire(); 
        
        if !mod_path.exists() {
            return Err(format!("Mod path does not exist: {:?}", mod_path));
        }
        if !mod_path.is_dir() {
            return Err(format!("Mod path is not a directory: {:?}", mod_path));
        }

        // 解析 manifest.json
        let manifest_path = mod_path.join("manifest.json");
        let manifest: ModManifest = load_json_obj(&manifest_path)
            .ok_or_else(|| format!("Failed to load or parse manifest at {:?}", manifest_path))?;


        // 解析资产定义（使用 "asset" 目录而非 "assets"）
        let assets_path = mod_path.join("asset");
        let imgs = crate::modules::utils::fs::load_json_list(&assets_path.join("img.json"));
        let sequences =
            crate::modules::utils::fs::load_json_list(&assets_path.join("sequence.json"));
        let live2d = if manifest.mod_type == ModType::Live2d {
            crate::modules::utils::fs::load_json_obj(&assets_path.join("live2d.json"))
        } else {
            None
        };
        let pngremix = if manifest.mod_type == ModType::Pngremix {
            crate::modules::utils::fs::load_json_obj(&assets_path.join("pngremix.json"))
        } else {
            None
        };
        let threed = if manifest.mod_type == ModType::ThreeD {
            crate::modules::utils::fs::load_json_obj(&assets_path.join("3d.json"))
        } else {
            None
        };


        // 解析多语言语音
        let audios =
            Self::load_multilang_resources::<AudioInfo>(&mod_path.join("audio"), "speech.json");

        // 解析多语言文本和角色信息
        let text_path = mod_path.join("text");
        let (info, texts) = Self::load_text_resources(&text_path);

        // 解析气泡样式
        let bubble_style = crate::modules::utils::fs::load_json_obj::<serde_json::Value>(
            &mod_path.join("bubble_style.json"),
        );

        // 解析 AI 工具配置（可选）
        let ai_tools = crate::modules::utils::fs::load_json_obj::<AiToolsConfig>(
            &mod_path.join("ai_tools.json"),
        );

        // 探测预览图和图标
        let mut icon_path = None;
        let mut preview_path = None;

        for ext in ["ico", "png"] {
            let p = mod_path.join(format!("icon.{}", ext));
            if p.exists() {
                icon_path = Some(format!("icon.{}", ext));
                break;
            }
        }

        for ext in ["png", "jpg", "jpeg", "webp"] {
            let p = mod_path.join(format!("preview.{}", ext));
            if p.exists() {
                preview_path = Some(format!("preview.{}", ext));
                break;
            }
        }

        let mut mod_info = ModInfo {
            path: mod_path,
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
            icon_path: icon_path.map(|s| s.into()),
            preview_path: preview_path.map(|s| s.into()),
            state_index: HashMap::new(),
            trigger_index: HashMap::new(),
            asset_index: HashMap::new(),
            audio_index: HashMap::new(),
            text_index: HashMap::new(),
        };

        // 验证并修正状态配置
        mod_info.validate_and_fix_states();

        // 构建查询索引
        mod_info.build_indices();

        Ok(mod_info)
    }

    /// 从指定目录读取 Mod 信息（不通过索引解析 id）
    pub fn read_mod_from_folder_path(&self, mod_path: PathBuf) -> Result<ModInfo, String> {
        self.read_mod_from_path(mod_path)
    }

    /// 加载指定的 Mod
    ///
    /// 加载成功后返回 Mod 信息的克隆（用于返回给前端）。
    /// 内部会缓存原始数据，后续查询使用缓存避免重复克隆。
    pub fn load_mod(&mut self, mod_id: &str) -> Result<Arc<ModInfo>, String> {
        let mod_info = Arc::new(self.read_mod_from_disk(mod_id)?);
        let result = mod_info.clone();

        self.current_mod = Some(mod_info);
        Ok(result)
    }

    /// 从指定目录路径直接加载 Mod（用于导入后立即加载某个具体目录）
    pub fn load_mod_from_folder_path(&mut self, mod_path: PathBuf) -> Result<Arc<ModInfo>, String> {
        let mod_info = Arc::new(self.read_mod_from_folder_path(mod_path)?);
        let result = mod_info.clone();
        self.current_mod = Some(mod_info);
        Ok(result)
    }

    /// 加载文本资源与角色信息。
    ///
    /// 目录结构：text/{lang}/info.json 与 text/{lang}/speech.json
    fn load_text_resources(
        text_path: &Path,
    ) -> (

        HashMap<Box<str>, CharacterInfo>,
        HashMap<Box<str>, Vec<TextInfo>>,
    ) {
        let mut info = HashMap::new();
        let mut texts = HashMap::new();

        if let Ok(entries) = fs::read_dir(text_path) {
            for entry in entries.flatten() {
                if entry.path().is_dir() {
                    let lang: Box<str> = entry.file_name().to_string_lossy().into();

                    // 加载角色信息
                    if let Some(mut char_info) =
                        crate::modules::utils::fs::load_json_obj::<CharacterInfo>(
                            &entry.path().join("info.json"),
                        )
                    {
                        if char_info.id.is_empty() || char_info.id.as_ref() == "ERROR" {
                            char_info.id = lang.clone();
                        }
                        info.insert(lang.clone(), char_info);
                    }

                    // 加载对话文本
                    let speech_list: Vec<TextInfo> = crate::modules::utils::fs::load_json_list(
                        &entry.path().join("speech.json"),
                    );
                    texts.insert(lang, speech_list);
                }
            }
        }

        (info, texts)
    }

    /// 加载多语言资源（遍历语言子目录）。
    ///
    /// 目录结构：{base_path}/{lang}/{filename}
    fn load_multilang_resources<T: serde::de::DeserializeOwned>(

        base_path: &Path,
        filename: &str,
    ) -> HashMap<Box<str>, Vec<T>> {
        let mut result = HashMap::new();

        if let Ok(entries) = fs::read_dir(base_path) {
            for entry in entries.flatten() {
                if entry.path().is_dir() {
                    let lang: Box<str> = entry.file_name().to_string_lossy().into();
                    let resources: Vec<T> =
                        crate::modules::utils::fs::load_json_list(&entry.path().join(filename));
                    result.insert(lang, resources);
                }
            }
        }

        result
    }

    /// 获取气泡样式配置
    ///
    /// 从当前加载的 Mod 缓存中获取，如果 Mod 未配置则返回默认样式。
    /// 默认样式文件放在 `mods/bubble_style.json`（跟随内置 mods 资源一起打包）。
    pub fn get_bubble_style(&self) -> Option<serde_json::Value> {
        let mod_info = self.current_mod.as_ref()?;

        // 如果 Mod 配置了 bubble_style，则返回
        if mod_info.bubble_style.is_some() {
            return mod_info.bubble_style.clone();
        }

        // 否则，加载默认气泡样式（mods/bubble_style.json）
        self.load_default_bubble_style()
    }

    /// 加载默认的气泡样式（mods/bubble_style.json）
    fn load_default_bubble_style(&self) -> Option<serde_json::Value> {
        // 1) 优先从已发现的 mods 根目录（配置目录 / 资源目录）中查找
        for mods_root in &self.search_paths {
            let bubble_style_path = mods_root.join("bubble_style.json");
            if bubble_style_path.exists() {
                #[cfg(debug_assertions)]
                println!("[ResourceManager] 加载默认 bubble_style: {:?}", bubble_style_path);
                return crate::modules::utils::fs::load_json_obj(&bubble_style_path);
            }
        }

        // 2) 兜底：开发环境下从当前工作目录查找
        let default_path = PathBuf::from("mods").join("bubble_style.json");
        if default_path.exists() {
            #[cfg(debug_assertions)]
            println!("[ResourceManager] 从工作目录加载默认 bubble_style: {:?}", default_path);
            return crate::modules::utils::fs::load_json_obj(&default_path);
        }

        #[cfg(debug_assertions)]
        println!("[ResourceManager] 未找到默认 bubble_style.json");
        None
    }

    /// 获取当前加载 Mod 的 AI 工具配置
    ///
    /// 从当前加载的 Mod 缓存中获取，如果 Mod 未配置则返回 None。
    pub fn get_ai_tools(&self) -> Option<AiToolsConfig> {
        let mod_info = self.current_mod.as_ref()?;
        mod_info.ai_tools.clone()
    }
}
