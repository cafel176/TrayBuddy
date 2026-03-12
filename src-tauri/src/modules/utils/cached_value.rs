//! 线程安全的全局缓存值封装
//!
//! 提供 `CachedValue<T>` 类型，替代散布于各模块的
//! `static Mutex<Option<T>>` + getter/setter 样板代码。

use std::sync::Mutex;

/// 线程安全的全局缓存值。
///
/// 使用方式：
/// ```rust,no_run
/// use traybuddy_lib::modules::utils::CachedValue;
///
/// static CACHED_FOO: CachedValue<String> = CachedValue::new();
///
/// CACHED_FOO.set("hello".to_string());
/// let val: Option<String> = CACHED_FOO.get();
/// CACHED_FOO.clear();
/// ```
pub struct CachedValue<T>(Mutex<Option<T>>);

impl<T> CachedValue<T> {
    /// 创建空的缓存值（`const fn`，可用于 `static` 初始化）
    pub const fn new() -> Self {
        Self(Mutex::new(None))
    }
}

impl<T: Clone> CachedValue<T> {
    /// 获取缓存值的克隆副本，如果 Mutex 被污染或为空则返回 `None`
    pub fn get(&self) -> Option<T> {
        self.0.lock().ok().and_then(|guard| guard.clone())
    }
}

impl<T> CachedValue<T> {
    /// 设置缓存值
    pub fn set(&self, value: T) {
        if let Ok(mut guard) = self.0.lock() {
            *guard = Some(value);
        }
    }

    /// 清空缓存值
    pub fn clear(&self) {
        if let Ok(mut guard) = self.0.lock() {
            *guard = None;
        }
    }

    /// 获取 Mutex 的可变锁守卫，用于需要原地修改的场景
    ///
    /// 例如对 `HashMap` 执行 `get_mut` 等操作时，使用 `with_lock` 比先 `get` clone 再 `set` 更高效。
    pub fn with_lock<R>(&self, f: impl FnOnce(&mut Option<T>) -> R) -> Option<R> {
        self.0.lock().ok().map(|mut guard| f(&mut guard))
    }
}

// SAFETY: CachedValue 通过 Mutex 保护内部数据，可安全跨线程共享
unsafe impl<T: Send> Sync for CachedValue<T> {}
