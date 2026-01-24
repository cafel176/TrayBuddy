/**
 * 简易 Markdown 解析器
 * 
 * 支持的语法:
 * - **text** 加粗
 * - [text](url) 超链接
 * - \n 换行
 */

/**
 * 解析简易 Markdown 为 HTML
 * @param text 原始文本
 * @returns HTML 字符串
 */
export function parseMarkdown(text: string): string {
  if (!text) return '';
  
  return text
    // 转义 HTML 特殊字符（防止 XSS）
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // 加粗 **text**
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    // 链接 [text](url)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    // 换行
    .replace(/\n/g, '<br>');
}

/**
 * 计算文本显示时长（基于字符数）
 * @param text 文本内容
 * @param charsPerSecond 每秒显示字符数，默认 10
 * @param minDuration 最小时长（毫秒），默认 2000
 * @param maxDuration 最大时长（毫秒），默认 10000
 * @returns 显示时长（毫秒）
 */
export function calculateDisplayDuration(
  text: string,
  charsPerSecond = 10,
  minDuration = 2000,
  maxDuration = 10000
): number {
  if (!text) return minDuration;
  
  const duration = (text.length / charsPerSecond) * 1000;
  return Math.max(minDuration, Math.min(maxDuration, duration));
}
