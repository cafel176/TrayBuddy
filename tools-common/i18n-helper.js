(function () {
    if (window.__TB_I18N_CORE_LOADED__) return;
    window.__TB_I18N_CORE_LOADED__ = true;

    const defaultOptions = {
        injectTopBar: false,
        storageKey: 'tool-lang',
        fileHintHtml: ''
    };

    const options = Object.assign({}, defaultOptions, window.__TB_I18N_OPTIONS__ || {});
    const storageKey = options.storageKey || 'tool-lang';

    function getFileHintHtml() {
        if (options.fileHintHtml) return options.fileHintHtml;

        return `
            <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;">
                <div>
                    <div style="font-weight:700;margin-bottom:4px;">i18n 资源加载失败</div>
                    <div>你正在以 <code style="color:#fcd34d;">file://</code> 方式打开页面，浏览器会拦截对本地 <code style="color:#fcd34d;">i18n/*.json</code> 的 <code style="color:#fcd34d;">fetch</code>。</div>
                    <div>请使用本地 HTTP 服务打开（例如 VSCode Live Server / http-server）。</div>
                </div>
                <button type="button" aria-label="close" style="cursor:pointer;background:transparent;border:0;color:#fbbf24;font-weight:700;font-size:14px;line-height:1;">×</button>
            </div>
        `;
    }

    window.i18n = {
        translations: {},
        currentLang: '',
        t: function (key, params) {
            let text = this.translations[key] || key;
            if (params && typeof params === 'object') {
                for (const [k, v] of Object.entries(params)) {
                    text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), v);
                }
            }
            return text;
        },
        updateDOM: function () {
            const translations = this.translations;
            document.querySelectorAll('[data-i18n]').forEach(el => {
                const key = el.getAttribute('data-i18n');
                let text = translations[key] || key;

                const attrs = el.attributes;
                for (let i = 0; i < attrs.length; i++) {
                    const attr = attrs[i];
                    if (attr.name.startsWith('data-i18n-')) {
                        const varName = attr.name.replace('data-i18n-', '');
                        text = text.replace(`{${varName}}`, attr.value);
                    }
                }

                if (el.tagName === 'INPUT' && (el.getAttribute('type') === 'text' || el.getAttribute('type') === 'button' || el.getAttribute('type') === 'submit')) {
                    el.value = text;
                } else if (el.tagName === 'TITLE') {
                    document.title = text;
                } else {
                    if (text.includes('<') && text.includes('>')) {
                        el.innerHTML = text;
                    } else {
                        el.innerText = text;
                    }
                }
            });

            document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
                const key = el.getAttribute('data-i18n-placeholder');
                el.placeholder = translations[key] || key;
            });

            document.querySelectorAll('.lang-btn').forEach(btn => {
                btn.classList.toggle('active', btn.getAttribute('data-lang') === this.currentLang);
            });
        },
        _safeGetLocalStorage: function (key) {
            try {
                return localStorage.getItem(key);
            } catch (e) {
                return null;
            }
        },
        _safeSetLocalStorage: function (key, value) {
            try {
                localStorage.setItem(key, value);
            } catch (e) {
                // ignore
            }
        },
        _normalizeLang: function (lang) {
            if (!lang) return 'en';
            const lower = String(lang).toLowerCase();
            if (lower.startsWith('zh')) return 'zh';
            if (lower.startsWith('ja')) return 'ja';
            if (lower.startsWith('en')) return 'en';
            const primary = lower.split('-')[0];
            return primary || 'en';
        },
        init: async function () {
            const stored = this._safeGetLocalStorage(storageKey);
            const browserLang = navigator.language || navigator.userLanguage || 'en';
            const lang = this._normalizeLang(stored || browserLang);
            await this.setLanguage(lang);
        },
        _loadJsonViaFsIfPossible: async function (url) {
            try {
                const req = window.require;
                if (typeof req !== 'function') return null;
                const fs = req('fs');

                const fileUrl = new URL(url, window.location.href);
                if (fileUrl.protocol !== 'file:') return null;

                let pathname = decodeURIComponent(fileUrl.pathname);
                if (pathname.startsWith('/') && /^[A-Za-z]:/.test(pathname.slice(1))) {
                    pathname = pathname.slice(1);
                }
                const filePath = pathname.replace(/\//g, '\\');

                const jsonText = await fs.promises.readFile(filePath, 'utf8');
                return JSON.parse(jsonText);
            } catch (e) {
                return null;
            }
        },
        _showFileProtocolHintOnce: function () {
            try {
                if (document.getElementById('tool-i18n-file-hint')) return;

                const bar = document.createElement('div');
                bar.id = 'tool-i18n-file-hint';
                bar.style.cssText = [
                    'position: sticky',
                    'top: 0',
                    'z-index: 10000',
                    'margin: 0 0 12px 0',
                    'padding: 10px 14px',
                    'border-radius: 10px',
                    'background: rgba(245, 158, 11, 0.14)',
                    'border: 1px solid rgba(245, 158, 11, 0.35)',
                    'color: #fbbf24',
                    'font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
                    'font-size: 13px',
                    'line-height: 1.35'
                ].join(';');

                bar.innerHTML = getFileHintHtml();

                const closeBtn = bar.querySelector('button');
                if (closeBtn) closeBtn.addEventListener('click', () => bar.remove());

                const topBar = document.querySelector('.tool-i18n-top-bar');
                if (topBar && topBar.parentNode) {
                    topBar.insertAdjacentElement('afterend', bar);
                } else {
                    document.body.prepend(bar);
                }
            } catch (e) {
                // ignore
            }
        },
        _loadJson: async function (url) {
            try {
                const response = await fetch(url, { cache: 'no-cache' });
                if (response && response.ok) return await response.json();
            } catch (e) {
                // ignore
            }

            if (window.location && window.location.protocol === 'file:') {
                const viaFs = await this._loadJsonViaFsIfPossible(url);
                if (viaFs) return viaFs;
            }

            return null;
        },
        setLanguage: async function (lang) {
            const normalized = this._normalizeLang(lang);
            const candidates = [];

            if (lang) candidates.push(lang);
            if (normalized && !candidates.includes(normalized)) candidates.push(normalized);
            if (!candidates.includes('en')) candidates.push('en');

            let loadedLang = '';
            let loadedTranslations = null;

            for (const candidate of candidates) {
                const url = `./i18n/${candidate}.json`;
                const json = await this._loadJson(url);
                if (!json) continue;

                loadedTranslations = json;
                loadedLang = candidate;
                break;
            }

            if (!loadedTranslations || !loadedLang) {
                const isFile = window.location && window.location.protocol === 'file:';
                console.error('Failed to load i18n', { lang, candidates, isFile });
                if (isFile) {
                    console.warn('[i18n] 当前以 file:// 打开页面，浏览器通常会拦截对本地 JSON 的 fetch。建议用本地 HTTP server 打开。');
                    this._showFileProtocolHintOnce();
                }
                return;
            }

            this.translations = loadedTranslations;
            this.currentLang = loadedLang;

            this._safeSetLocalStorage(storageKey, loadedLang);
            document.documentElement.lang = loadedLang;

            this.updateDOM();

            window.dispatchEvent(new CustomEvent('languageChanged', { detail: { lang: loadedLang, translations: this.translations } }));
        }
    };

    window.setLanguage = (lang) => window.i18n.setLanguage(lang);
    window.initI18n = () => window.i18n.init();

    function injectTopBar() {
        const topBar = document.createElement('div');
        topBar.className = 'tool-i18n-top-bar';
        topBar.innerHTML = `
            <div class="tool-i18n-title" data-i18n="title">Tool</div>
            <div class="tool-i18n-langs">
                <button class="lang-btn" data-lang="zh" type="button">ZH</button>
                <button class="lang-btn" data-lang="en" type="button">EN</button>
                <button class="lang-btn" data-lang="ja" type="button">JA</button>
            </div>
        `;
        document.body.prepend(topBar);

        topBar.querySelectorAll('.lang-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const lang = btn.getAttribute('data-lang');
                window.i18n.setLanguage(lang);
            });
        });

        const style = document.createElement('style');
        style.textContent = `
            .tool-i18n-top-bar {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 10px 24px;
                background: #1a1a1a;
                border-bottom: 1px solid #333;
                position: sticky;
                top: 0;
                z-index: 9999;
                font-family: sans-serif;
                color: #fff;
            }
            .tool-i18n-title {
                font-weight: 700;
                font-size: 1.1rem;
                background: linear-gradient(90deg, #60a5fa, #3b82f6);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
            }
            .tool-i18n-langs {
                display: flex;
                gap: 8px;
            }
            .lang-btn {
                padding: 4px 10px;
                cursor: pointer;
                background: #262626;
                color: #a3a3a3;
                border: 1px solid #333;
                border-radius: 6px;
                font-size: 0.8rem;
                font-weight: 600;
                transition: all 0.2s;
            }
            .lang-btn:hover {
                background: #333;
                color: #fff;
            }
            .lang-btn.active {
                background: #3b82f6;
                color: #fff;
                border-color: #3b82f6;
            }
            body { margin-top: 0 !important; }
        `;
        document.head.appendChild(style);
    }

    function initWhenReady() {
        if (options.injectTopBar && !document.querySelector('.tool-i18n-top-bar') && !document.querySelector('.lang-btn')) {
            injectTopBar();
        }
        window.i18n.init();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initWhenReady);
    } else {
        initWhenReady();
    }
})();
