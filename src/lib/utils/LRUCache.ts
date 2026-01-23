/**
 * LRU 缓存实现
 *
 * LRU (Least Recently Used) 缓存，当缓存满时淘汰最久未使用的条目。
 *
 * ## 实现原理
 * 使用 JavaScript Map 的有序特性：
 * - Map 按插入顺序迭代
 * - 每次访问时删除再插入，将条目移到末尾
 * - 淘汰时删除第一个条目（最久未使用）
 *
 * ## 时间复杂度
 * - get: O(1)
 * - set: O(1)
 * - delete: O(1)
 *
 * ## 使用示例
 * ```typescript
 * const cache = new LRUCache<string, number>(3);
 * cache.set("a", 1);
 * cache.set("b", 2);
 * cache.set("c", 3);
 * cache.get("a");     // 访问 a，移到最近位置
 * cache.set("d", 4);  // 缓存满，淘汰 b
 * ```
 */
export class LRUCache<K, V> {
  /** 内部存储 Map */
  private cache = new Map<K, V>();
  
  /**
   * 创建 LRU 缓存
   * @param maxSize - 最大缓存条目数
   */
  constructor(private maxSize: number) {}
  
  /**
   * 获取缓存值
   *
   * 访问时会将条目移到最近使用位置
   *
   * @param key - 缓存键
   * @returns 缓存值，不存在返回 undefined
   */
  get(key: K): V | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) {
      // 移动到最近使用位置：删除后重新插入到末尾
      this.cache.delete(key);
      this.cache.set(key, value);
    }
    return value;
  }
  
  /**
   * 设置缓存值
   *
   * 如果缓存已满，会淘汰最久未使用的条目
   *
   * @param key - 缓存键
   * @param value - 缓存值
   */
  set(key: K, value: V): void {
    // 如果已存在，先删除旧条目（确保插入到末尾）
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      // LRU 淘汰：删除第一个条目（最久未使用）
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) this.cache.delete(firstKey);
    }
    this.cache.set(key, value);
  }
  
  /**
   * 检查键是否存在
   * @param key - 缓存键
   * @returns 是否存在
   */
  has(key: K): boolean {
    return this.cache.has(key);
  }
  
  /**
   * 删除缓存条目
   * @param key - 缓存键
   * @returns 是否删除成功
   */
  delete(key: K): boolean {
    return this.cache.delete(key);
  }
  
  /**
   * 清空缓存
   */
  clear(): void {
    this.cache.clear();
  }
  
  /**
   * 获取当前缓存大小
   */
  get size(): number {
    return this.cache.size;
  }
}
