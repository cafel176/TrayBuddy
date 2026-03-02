//! Mod 导入导出

use crate::app_state::AppState;
use crate::modules::event_manager::{emit, events};
use crate::modules::resource::{ModManifest, ModSummary};
use tauri::{AppHandle, Manager, State};


/// 获取指定 Mod 的详细信息 (不加载)
#[tauri::command]
pub(crate) fn get_mod_details(
    state: State<'_, AppState>,
    mod_id: String,
) -> Result<ModSummary, String> {
    let mut mgr = state.resource_manager.lock().unwrap();
    mgr.read_mod_from_disk(&mod_id).map(|info| info.to_summary())
}

/// 解析 .tbuddy(zip) 中的 manifest 信息
#[derive(Debug, serde::Serialize)]
pub struct ModTbuddyPreflight {
    pub id: String,
    pub version: String,
}

struct ImportedModResult {
    pub id: String,
    /// 复制到 mods 目录后的包文件路径（.tbuddy 或 .sbuddy）
    pub archive_path: std::path::PathBuf,
    /// 文件扩展名（"tbuddy" 或 "sbuddy"）
    pub ext: String,
}

/// 将 .tbuddy / .sbuddy 文件复制到 mods 目录下（不解压，保密要求）
///
/// 文件名格式: `{manifest.id}.{ext}`
/// 如果目标已存在同名文件，先删除旧文件再复制
fn copy_archive_to_mods_dir(
    app: &AppHandle,
    src_path: &std::path::Path,
) -> Result<ImportedModResult, String> {
    use std::fs;

    let ext = src_path
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    if ext != "tbuddy" && ext != "sbuddy" {
        return Err(format!("Unsupported file format: .{}", ext));
    }

    // 1) 目标 mods 目录
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("Failed to get config dir: {}", e))?;
    let mods_dir = config_dir.join("mods");
    if !mods_dir.exists() {
        fs::create_dir_all(&mods_dir)
            .map_err(|e| format!("Failed to create mods directory: {}", e))?;
    }

    // 2) 读取 manifest.id
    let manifest = read_manifest_from_archive_file(src_path)?;
    let manifest_id = manifest.id.to_string();

    // 3) 构造目标文件名: {manifest.id}.{ext}
    let target_name = format!("{}.{}", manifest_id, ext);
    let target_path = mods_dir.join(&target_name);

    // 4) 如果源文件与目标相同（已在 mods 目录中），无需复制
    if let (Ok(src), Ok(dst)) = (dunce::canonicalize(src_path), dunce::canonicalize(&target_path)) {
        if src == dst {
            return Ok(ImportedModResult {
                id: manifest_id,
                archive_path: target_path,
                ext: ext.to_string(),
            });
        }
    }

    // 5) 如果目标已存在，先删除旧文件
    if target_path.exists() {
        fs::remove_file(&target_path)
            .map_err(|e| format!("Failed to remove existing file '{}': {}", target_name, e))?;
    }

    // 6) 复制文件（不解压/不处理）
    fs::copy(src_path, &target_path)
        .map_err(|e| format!("Failed to copy .{} file: {}", ext, e))?;

    #[cfg(debug_assertions)]
    println!("[import] Copied .{} to {:?}", ext, target_path);

    Ok(ImportedModResult {
        id: manifest_id,
        archive_path: target_path,
        ext: ext.to_string(),
    })
}

/// 从 ZipArchive (Cursor<&Vec<u8>>) 中获取根目录名（用于处理后的 .sbuddy）
fn get_zip_root_folder<R: std::io::Read + std::io::Seek>(
    archive: &mut zip::ZipArchive<R>,
) -> Result<String, String> {
    use std::path::Component;

    let mut root: Option<String> = None;

    for i in 0..archive.len() {
        let file = archive.by_index(i).map_err(|e| e.to_string())?;
        let Some(enclosed) = file.enclosed_name() else {
            continue;
        };

        let Some(Component::Normal(first)) = enclosed.components().next() else {
            continue;
        };

        let first = first.to_string_lossy().into_owned();
        match root.as_ref() {
            None => root = Some(first),
            Some(existing) if existing == &first => {}
            Some(existing) => {
                return Err(format!(
                    "Invalid archive (multiple root folders: '{}' and '{}')",
                    existing, first
                ));
            }
        }
    }

    root.ok_or_else(|| "Invalid archive (missing root folder)".into())
}

/// 从 ZipArchive (Cursor<&Vec<u8>>) 中读取 manifest.json（用于处理后的 .sbuddy）
fn read_zip_manifest<R: std::io::Read + std::io::Seek>(
    archive: &mut zip::ZipArchive<R>,
    root_folder: &str,
) -> Result<ModManifest, String> {
    use std::io::Read;

    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(|e| e.to_string())?;
        let Some(enclosed) = file.enclosed_name() else {
            continue;
        };

        let Some(first) = enclosed.components().next() else {
            continue;
        };
        if first.as_os_str() != std::ffi::OsStr::new(root_folder) {
            continue;
        }

        if enclosed
            .file_name()
            .map(|n| n == std::ffi::OsStr::new("manifest.json"))
            .unwrap_or(false)
        {
            let mut buf = Vec::new();
            file.read_to_end(&mut buf).map_err(|e| e.to_string())?;
            let content = String::from_utf8(buf).map_err(|e| e.to_string())?;
            return serde_json::from_str::<ModManifest>(&content)
                .map_err(|e| format!("Failed to parse manifest: {}", e));
        }
    }

    Err("Invalid archive (manifest.json not found)".into())
}

/// 从 .tbuddy / .sbuddy 文件路径读取 manifest（不落盘）
///
/// 统一处理 .tbuddy（ZIP 格式）和 .sbuddy（处理后再按 ZIP 读取）两种格式。
fn read_manifest_from_archive_file(path: &std::path::Path) -> Result<ModManifest, String> {
    let ext = path
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();

    if ext == "sbuddy" {
        if !crate::modules::mod_archive::is_sbuddy_supported() {
            return Err("sbuddy tool not found (sbuddy not supported)".into());
        }
        let data = std::fs::read(path).map_err(|e| e.to_string())?;
        let zip_data = crate::modules::mod_archive::decrypt_sbuddy(&data)?;
        let cursor = std::io::Cursor::new(&zip_data);
        let mut archive = zip::ZipArchive::new(cursor)
            .map_err(|_| "Invalid .sbuddy file".to_string())?;
        let root = get_zip_root_folder(&mut archive)?;
        read_zip_manifest(&mut archive, &root)
    } else {
        let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
        let mut archive = zip::ZipArchive::new(file)
            .map_err(|_| "Invalid .tbuddy file (not a valid zip)".to_string())?;
        let root = get_zip_root_folder(&mut archive)?;
        read_zip_manifest(&mut archive, &root)
    }
}

/// 预解析 Mod (.tbuddy / .sbuddy 文件) 的 manifest（不落盘，用于前端冲突提示）
#[tauri::command]
pub(crate) fn inspect_mod_tbuddy(file_path: String) -> Result<ModTbuddyPreflight, String> {
    let manifest = read_manifest_from_archive_file(std::path::Path::new(&file_path))?;
    Ok(ModTbuddyPreflight {
        id: manifest.id.to_string(),
        version: manifest.version.to_string(),
    })
}

/// 选择并预解析 Mod (.tbuddy / .sbuddy 文件) 的 manifest（不落盘）
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModTbuddyPick {
    pub file_path: String,
    pub id: String,
    pub version: String,
}

#[tauri::command]
pub(crate) async fn pick_mod_tbuddy(app: AppHandle) -> Result<ModTbuddyPick, String> {
    use tauri_plugin_dialog::DialogExt;

    println!("[pick_mod_tbuddy] called");

    let app_for_dialog = app.clone();
    let file_path = tokio::task::spawn_blocking(move || {
        app_for_dialog
            .dialog()
            .file()
            .add_filter("TrayBuddy Mod", &["tbuddy", "sbuddy"])
            .blocking_pick_file()
    })
    .await
    .map_err(|e| format!("Open dialog failed: {}", e))?;

    let selected_path = match file_path {
        Some(path) => match path {
            tauri_plugin_dialog::FilePath::Path(p) => p,
            _ => return Err("Unsupported file path".into()),
        },
        None => {
            return Err("Canceled".into());
        }
    };

    let selected_path_clone = selected_path.clone();
    let (id, version) = tokio::task::spawn_blocking(move || -> Result<(String, String), String> {
        let manifest = read_manifest_from_archive_file(&selected_path_clone)?;
        Ok((manifest.id.to_string(), manifest.version.to_string()))
    })
    .await
    .map_err(|e| format!("Parse mod failed: {}", e))??;

    Ok(ModTbuddyPick {
        file_path: selected_path.to_string_lossy().into_owned(),
        id,
        version,
    })
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportModResult {
    pub id: String,
    pub extracted_path: String,
}

/// 导入 archive 并加载到内存 store 的公共逻辑
///
/// 返回 `ImportedModResult` 供调用方组装不同的返回值。
async fn import_and_load_archive(
    app: &AppHandle,
    state: &State<'_, AppState>,
    file_path: String,
) -> Result<ImportedModResult, String> {
    use std::path::PathBuf;

    let src_path = PathBuf::from(file_path);
    let imported = copy_archive_to_mods_dir(app, &src_path)?;

    // 将新复制的包文件加载到内存 archive store
    {
        let archive_store = {
            let rm = state.resource_manager.lock().unwrap();
            rm.get_archive_store().cloned()
        };
        if let Some(store) = archive_store {
            let mut s = store.lock().unwrap();
            if imported.ext == "sbuddy" {
                let _ = s.load_sbuddy(&imported.archive_path);
            } else {
                let _ = s.load_tbuddy(&imported.archive_path);
            }
        }
    }

    let _ = emit(app, events::REFRESH_MODS, imported.id.as_str());

    Ok(imported)
}

/// 从指定路径导入 Mod (.tbuddy / .sbuddy 文件)
///
/// 将文件复制到 mods 目录下，然后加载到内存中的 archive store
#[tauri::command]
pub(crate) async fn import_mod_from_path(
    app: AppHandle,
    state: State<'_, AppState>,
    file_path: String,
) -> Result<String, String> {
    let imported = import_and_load_archive(&app, &state, file_path).await?;
    Ok(imported.id)
}

/// 从指定路径导入 Mod (.tbuddy / .sbuddy 文件)，并返回包文件路径
#[tauri::command]
pub(crate) async fn import_mod_from_path_detailed(
    app: AppHandle,
    state: State<'_, AppState>,
    file_path: String,
) -> Result<ImportModResult, String> {
    let imported = import_and_load_archive(&app, &state, file_path).await?;
    Ok(ImportModResult {
        id: imported.id,
        extracted_path: imported.archive_path.to_string_lossy().into_owned(),
    })
}

/// 导入 Mod (.tbuddy / .sbuddy 文件)
///
/// 兼容旧前端：仍由后端弹出文件选择框。
#[tauri::command]
pub(crate) async fn import_mod(app: AppHandle, state: State<'_, AppState>) -> Result<String, String> {
    use tauri_plugin_dialog::DialogExt;

    let app_for_dialog = app.clone();
    let file_path = tokio::task::spawn_blocking(move || {
        app_for_dialog
            .dialog()
            .file()
            .add_filter("TrayBuddy Mod", &["tbuddy", "sbuddy"])
            .blocking_pick_file()
    })
    .await
    .map_err(|e| format!("Open dialog failed: {}", e))?;

    let selected_path = match file_path {
        Some(path) => match path {
            tauri_plugin_dialog::FilePath::Path(p) => p,
            _ => return Err("Unsupported file path".into()),
        },
        None => return Err("Canceled".into()),
    };

    import_mod_from_path(app, state, selected_path.to_string_lossy().into_owned()).await
}

/// 检查外部工具是否可用
#[tauri::command]
pub(crate) fn is_sbuddy_supported() -> bool {
    crate::modules::mod_archive::is_sbuddy_supported()
}

/// 将 Mod 导出为 .sbuddy 包
///
/// 支持 .tbuddy 包、.sbuddy 包和文件夹 mod。
/// - .tbuddy：读取 ZIP 数据 → 处理 → 导出
/// - .sbuddy：直接复制源文件 → 导出
/// - 文件夹 mod：打包为 ZIP → 处理 → 导出
///
/// 弹出保存文件对话框，用户选择保存路径后写入。
#[tauri::command]
pub(crate) async fn export_mod_as_sbuddy(
    app: AppHandle,
    mod_id: String,
) -> Result<(), String> {
    use tauri_plugin_dialog::DialogExt;

    // 1) 后台生成处理数据（避免阻塞命令线程）
    let app_for_build = app.clone();
    let mod_id_for_build = mod_id.clone();
    let sbuddy_data = tokio::task::spawn_blocking(move || {
        let state: State<AppState> = app_for_build.state();

        // 尝试从 archive_store 获取源文件信息
        let archive_source_path = {
            let store = state.archive_store.lock().unwrap();
            store.get_source(&mod_id_for_build).map(|s| s.file_path.clone())
        };

        // 根据源文件类型决定生成 .sbuddy 的方式
        let sbuddy_data = if let Some(ref src_path) = archive_source_path {
            let ext = src_path
                .extension()
                .map(|e| e.to_string_lossy().to_lowercase())
                .unwrap_or_default();

            if ext == "sbuddy" {
                // .sbuddy 源：直接复制文件内容
                std::fs::read(src_path)
                    .map_err(|e| format!("Failed to read .sbuddy file: {}", e))?
            } else if ext == "tbuddy" {
                // .tbuddy 源：读取 ZIP → 处理
                let zip_data = std::fs::read(src_path)
                    .map_err(|e| format!("Failed to read .tbuddy file: {}", e))?;
                crate::modules::mod_archive::encrypt_sbuddy(&zip_data)?
            } else {
                // 其他类型：回退到文件夹打包
                let zip_data = zip_mod_directory(&state, &mod_id_for_build)?;
                crate::modules::mod_archive::encrypt_sbuddy(&zip_data)?
            }
        } else {
            // 文件夹 mod：打包为 ZIP → 处理
            let zip_data = zip_mod_directory(&state, &mod_id_for_build)?;
            crate::modules::mod_archive::encrypt_sbuddy(&zip_data)?
        };

        Ok::<Vec<u8>, String>(sbuddy_data)
    })
    .await
    .map_err(|e| format!("Build sbuddy failed: {}", e))??;

    // 2) 弹出保存文件对话框
    let default_name = format!("{}.sbuddy", mod_id);
    let app_for_dialog = app.clone();
    let save_path = tokio::task::spawn_blocking(move || {
        app_for_dialog
            .dialog()
            .file()
            .set_file_name(&default_name)
            .add_filter("SBuddy Encrypted Mod", &["sbuddy"])
            .blocking_save_file()
    })
    .await
    .map_err(|e| format!("Open dialog failed: {}", e))?;

    let save_path = match save_path {
        Some(path) => match path {
            tauri_plugin_dialog::FilePath::Path(p) => p,
            _ => return Err("Unsupported file path".into()),
        },
        None => return Err("Canceled".into()),
    };

    // 3) 写入文件
    let save_path_clone = save_path.clone();
    tokio::task::spawn_blocking(move || {
        std::fs::write(&save_path_clone, &sbuddy_data)
            .map_err(|e| format!("Failed to write .sbuddy file: {}", e))
    })
    .await
    .map_err(|e| format!("Write sbuddy failed: {}", e))??;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;
    use std::io::{Cursor, Write};
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};
    use zip::write::{SimpleFileOptions, ZipWriter};

    fn unique_temp_path(name: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        std::env::temp_dir().join(format!("traybuddy_{}_{}.zip", name, nanos))
    }

    fn write_zip_file(path: &PathBuf, entries: &[(&str, &str)]) {
        let file = File::create(path).expect("create zip");
        let mut zip = ZipWriter::new(file);
        let options = SimpleFileOptions::default();

        for (name, content) in entries {
            if name.ends_with('/') {
                zip.add_directory(*name, options).expect("add dir");
            } else {
                zip.start_file(*name, options).expect("start file");
                zip.write_all(content.as_bytes()).expect("write file");
            }
        }
        zip.finish().expect("finish zip");
    }

    fn build_zip_bytes(entries: &[(&str, &str)]) -> Vec<u8> {
        let cursor = Cursor::new(Vec::new());
        let mut zip = ZipWriter::new(cursor);
        let options = SimpleFileOptions::default();

        for (name, content) in entries {
            if name.ends_with('/') {
                zip.add_directory(*name, options).expect("add dir");
            } else {
                zip.start_file(*name, options).expect("start file");
                zip.write_all(content.as_bytes()).expect("write file");
            }
        }

        zip.finish().expect("finish zip").into_inner()
    }

    fn minimal_manifest_json(id: &str, version: &str) -> String {
        format!("{{\"id\":\"{}\",\"version\":\"{}\"}}", id, version)
    }

    #[test]
    fn get_tbuddy_root_folder_detects_single_root() {
        let path = unique_temp_path("root_ok");
        write_zip_file(
            &path,
            &[
                ("mod1/", ""),
                ("mod1/manifest.json", &minimal_manifest_json("m1", "1.0")),
                ("mod1/assets/a.txt", "hello"),
            ],
        );

        let file = File::open(&path).expect("open zip");
        let mut archive = zip::ZipArchive::new(file).expect("read zip");
        let root = get_zip_root_folder(&mut archive).expect("root");
        assert_eq!(root, "mod1");

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn get_tbuddy_root_folder_rejects_multiple_roots() {
        let path = unique_temp_path("root_bad");
        write_zip_file(
            &path,
            &[("mod1/a.txt", "a"), ("mod2/b.txt", "b")],
        );

        let file = File::open(&path).expect("open zip");
        let mut archive = zip::ZipArchive::new(file).expect("read zip");
        let err = get_zip_root_folder(&mut archive).unwrap_err();
        assert!(err.contains("multiple root folders"));

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn read_tbuddy_manifest_parses_manifest_json() {
        let path = unique_temp_path("manifest_ok");
        write_zip_file(
            &path,
            &[
                ("mod1/", ""),
                ("mod1/manifest.json", &minimal_manifest_json("m1", "1.0")),
            ],
        );

        let file = File::open(&path).expect("open zip");
        let mut archive = zip::ZipArchive::new(file).expect("read zip");
        let root = get_zip_root_folder(&mut archive).expect("root");
        let manifest = read_zip_manifest(&mut archive, &root).expect("manifest");
        assert_eq!(&*manifest.id, "m1");
        assert_eq!(&*manifest.version, "1.0");

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn read_zip_manifest_errors_when_missing() {
        let zip_bytes = build_zip_bytes(&[("mod1/", ""), ("mod1/a.txt", "x")]);
        let cursor = Cursor::new(zip_bytes);
        let mut archive = zip::ZipArchive::new(cursor).expect("read zip");
        let root = get_zip_root_folder(&mut archive).expect("root");
        let err = read_zip_manifest(&mut archive, &root).unwrap_err();
        assert!(err.contains("manifest.json"));
    }

    #[test]
    fn read_zip_manifest_parses_manifest_json() {
        let zip_bytes = build_zip_bytes(&[
            ("mod1/", ""),
            ("mod1/manifest.json", &minimal_manifest_json("m2", "2.0")),
        ]);
        let cursor = Cursor::new(zip_bytes);
        let mut archive = zip::ZipArchive::new(cursor).expect("read zip");
        let root = get_zip_root_folder(&mut archive).expect("root");
        let manifest = read_zip_manifest(&mut archive, &root).expect("manifest");
        assert_eq!(&*manifest.id, "m2");
        assert_eq!(&*manifest.version, "2.0");
    }
}


/// 将文件夹 mod 打包为 ZIP（内存中），用于导出
fn zip_mod_directory(state: &State<'_, AppState>, mod_id: &str) -> Result<Vec<u8>, String> {
    use std::io::{BufReader, Cursor, Write};

    use zip::write::{SimpleFileOptions, ZipWriter};

    // 解析 mod 的实际目录路径
    let mod_path = {
        let mut mgr = state.resource_manager.lock().unwrap();
        mgr.resolve_mod_path_public(mod_id)
            .ok_or_else(|| format!("Mod '{}' not found", mod_id))?
    };

    if !mod_path.is_dir() {
        return Err(format!("Mod path is not a directory: {}", mod_path.display()));
    }

    let buf = Cursor::new(Vec::new());
    let mut zip = ZipWriter::new(buf);
    let options = SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    // 递归添加文件
    fn add_dir_to_zip(
        zip: &mut ZipWriter<Cursor<Vec<u8>>>,
        base: &std::path::Path,
        current: &std::path::Path,
        options: SimpleFileOptions,
    ) -> Result<(), String> {
        let entries = std::fs::read_dir(current)
            .map_err(|e| format!("Failed to read directory {}: {}", current.display(), e))?;

        for entry in entries {
            let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
            let path = entry.path();
            let relative = path
                .strip_prefix(base)
                .map_err(|e| format!("Failed to compute relative path: {}", e))?;
            let name = relative.to_string_lossy().replace('\\', "/");

            if path.is_dir() {
                zip.add_directory(&format!("{}/", name), options)
                    .map_err(|e| format!("Failed to add directory to zip: {}", e))?;
                add_dir_to_zip(zip, base, &path, options)?;
            } else {
                zip.start_file(&name, options)
                    .map_err(|e| format!("Failed to start file in zip: {}", e))?;
                let file = std::fs::File::open(&path)
                    .map_err(|e| format!("Failed to read file {}: {}", path.display(), e))?;
                let mut reader = BufReader::new(file);
                std::io::copy(&mut reader, zip)
                    .map_err(|e| format!("Failed to write file to zip: {}", e))?;
            }
        }
        Ok(())
    }

    add_dir_to_zip(&mut zip, &mod_path, &mod_path, options)?;

    let cursor = zip.finish()
        .map_err(|e| format!("Failed to finalize zip: {}", e))?;

    Ok(cursor.into_inner())
}
