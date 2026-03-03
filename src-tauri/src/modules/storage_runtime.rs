// 运行时函数（依赖 AppHandle），拆分到独立文件以便排除覆盖率统计
// 通过 include!() 宏在 storage.rs 中引入

impl Storage {
    /// 初始化存储管理器
    /// 会自动定位到应用配置目录，如果 storage.json 存在则加载，
    /// 否则创建一个包含默认值的初始环境。
    pub fn new(app_handle: &tauri::AppHandle) -> Self {

        let storage_dir = Self::get_storage_dir(app_handle);
        let storage_path = storage_dir.join("storage.json");
        Self::new_with_path(storage_path)
    }

    /// 获取应用配置存储目录路径
    fn get_storage_dir(app_handle: &tauri::AppHandle) -> PathBuf {
        let storage_dir = app_handle
            .path()
            .app_config_dir()
            .unwrap_or_else(|_| PathBuf::from("."));

        // 确保目录存在
        if !storage_dir.exists() {
            let _ = fs::create_dir_all(&storage_dir);
        }

        #[cfg(debug_assertions)]
        println!("storage path: {:?}", storage_dir);

        storage_dir
    }
}
