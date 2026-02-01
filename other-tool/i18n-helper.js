(function() {
    window.i18n = {
        translations: {},
        currentLang: '',
        t: function(key) {
            return this.translations[key] || key;
        },
        updateDOM: function() {
            const translations = this.translations;
            document.querySelectorAll('[data-i18n]').forEach(el => {
                const key = el.getAttribute('data-i18n');
                let text = translations[key] || key;
                
                // Handle dynamic variables
                // data-i18n-n="10" -> {n}
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
                    // Support HTML tags if translation contains them (like <br>)
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

            // Update active state of lang buttons
            document.querySelectorAll('.lang-btn').forEach(btn => {
                btn.classList.toggle('active', btn.getAttribute('data-lang') === this.currentLang);
            });
        },
        _safeGetLocalStorage: function(key) {
            try {
                return localStorage.getItem(key);
            } catch (e) {
                return null;
            }
        },
        _safeSetLocalStorage: function(key, value) {
            try {
                localStorage.setItem(key, value);
            } catch (e) {
                // ignore
            }
        },
        _normalizeLang: function(lang) {
            if (!lang) return 'en';
            const lower = String(lang).toLowerCase();
            // common full tags
            if (lower.startsWith('zh')) return 'zh';
            if (lower.startsWith('ja')) return 'ja';
            if (lower.startsWith('en')) return 'en';
            // fallback to primary subtag
            const primary = lower.split('-')[0];
            return primary || 'en';
        },
        init: async function() {
            const stored = this._safeGetLocalStorage('tool-lang');
            const browserLang = navigator.language || navigator.userLanguage || 'en';
            const lang = this._normalizeLang(stored || browserLang);
            await this.setLanguage(lang);
        },
        _loadJsonViaFsIfPossible: async function(url) {
            try {
                const req = window.require;
                if (typeof req !== 'function') return null;
                const fs = req('fs');

                const fileUrl = new URL(url, window.location.href);
                if (fileUrl.protocol !== 'file:') return null;

                let pathname = decodeURIComponent(fileUrl.pathname);
                // Windows file URL: /D:/path -> D:/path
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
        _showFileProtocolHintOnce: function() {
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

                bar.innerHTML = `
                    <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;">
                        <div>
                            <div style="font-weight:700;margin-bottom:4px;">i18n 资源加载失败</div>
                            <div>你正在以 <code style="color:#fcd34d;">file://</code> 方式打开页面，浏览器会拦截对本地 <code style="color:#fcd34d;">i18n/*.json</code> 的 <code style="color:#fcd34d;">fetch</code>。</div>
                            <div>请使用本地 HTTP 服务打开（例如运行 <code style="color:#fcd34d;">node other-tool/dev-server.js</code>，然后访问 <code style="color:#fcd34d;">http://127.0.0.1:4173/...</code>）。</div>
                        </div>
                        <button type="button" aria-label="close" style="cursor:pointer;background:transparent;border:0;color:#fbbf24;font-weight:700;font-size:14px;line-height:1;">×</button>
                    </div>
                `;

                bar.querySelector('button').addEventListener('click', () => bar.remove());

                // Prefer showing below top bar if it exists, otherwise at top of body
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
        _loadJson: async function(url) {
            // 1) Try fetch first (works in http(s), and sometimes in relaxed file contexts)
            try {
                const response = await fetch(url, { cache: 'no-cache' });
                if (response && response.ok) return await response.json();
            } catch (e) {
                // ignore
            }

            // 2) If opened via file://, try Electron/nodeIntegration fallback
            if (window.location && window.location.protocol === 'file:') {
                const viaFs = await this._loadJsonViaFsIfPossible(url);
                if (viaFs) return viaFs;
            }

            return null;
        },
        setLanguage: async function(lang) {
            const normalized = this._normalizeLang(lang);
            const candidates = [];

            // try requested lang first (can be 'zh-CN' etc)
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
                    console.warn('[i18n] 当前以 file:// 打开页面，浏览器通常会拦截对本地 JSON 的 fetch。建议用本地 HTTP server 打开（例如 VSCode Live Server / http-server）。');
                    this._showFileProtocolHintOnce();
                }
                return;
            }

            this.translations = loadedTranslations;
            this.currentLang = loadedLang;

            this._safeSetLocalStorage('tool-lang', loadedLang);
            document.documentElement.lang = loadedLang;

            this.updateDOM();

            // Dispatch event for tool-specific updates
            window.dispatchEvent(new CustomEvent('languageChanged', { detail: { lang: loadedLang, translations: this.translations } }));
        }
    };

    // Shortcut for global setLanguage if needed by top bar
    window.setLanguage = (lang) => window.i18n.setLanguage(lang);
    window.initI18n = () => window.i18n.init();

    // Create and inject Top Bar
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

        // Bind events without inline handlers (more CSP/WebView friendly)
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

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            if (!document.querySelector('.tool-i18n-top-bar')) injectTopBar();
            window.i18n.init();
        });
    } else {
        if (!document.querySelector('.tool-i18n-top-bar')) injectTopBar();
        window.i18n.init();
    }
})();
