(function () {
    const currentScript = document.currentScript;
    const baseUrl = currentScript && currentScript.src ? currentScript.src : window.location.href;

    window.__TB_I18N_OPTIONS__ = {
        injectTopBar: true,
        fileHintI18n: {
            zh: {
                title: 'i18n 资源加载失败',
                line1: '你正在以 <code style="color:#fcd34d;">file://</code> 方式打开页面，浏览器会拦截对本地 <code style="color:#fcd34d;">i18n/*.json</code> 的 <code style="color:#fcd34d;">fetch</code>。',
                line2: '请使用本地 HTTP 服务打开（例如运行 <code style="color:#fcd34d;">{command}</code>，然后访问 <code style="color:#fcd34d;">{url}</code>）。'
            },
            en: {
                title: 'Failed to load i18n resources',
                line1: 'You opened the page via <code style="color:#fcd34d;">file://</code>, so the browser blocks fetching local <code style="color:#fcd34d;">i18n/*.json</code> with <code style="color:#fcd34d;">fetch</code>.',
                line2: 'Please open via a local HTTP server (e.g., run <code style="color:#fcd34d;">{command}</code>, then visit <code style="color:#fcd34d;">{url}</code>).' 
            },
            ja: {
                title: 'i18n リソースの読み込みに失敗しました',
                line1: 'ページを <code style="color:#fcd34d;">file://</code> で開いているため、ブラウザがローカルの <code style="color:#fcd34d;">i18n/*.json</code> への <code style="color:#fcd34d;">fetch</code> をブロックしています。',
                line2: 'ローカル HTTP サーバーで開いてください（例: <code style="color:#fcd34d;">{command}</code> を実行し、<code style="color:#fcd34d;">{url}</code> にアクセス）。'
            }
        },
        fileHintParams: {
            command: 'node my-tool/dev-server.js',
            url: 'http://127.0.0.1:4173/...'
        }
    };


    const coreUrl = new URL('../tools-common/i18n-helper.js', baseUrl).href;
    if (!document.querySelector('script[data-tb-i18n-core="true"]')) {
        const script = document.createElement('script');
        script.src = coreUrl;
        script.dataset.tbI18nCore = 'true';
        document.head.appendChild(script);
    }
})();
