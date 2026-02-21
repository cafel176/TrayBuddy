(function () {
    const currentScript = document.currentScript;
    const baseUrl = currentScript && currentScript.src ? currentScript.src : window.location.href;

    window.__TB_I18N_OPTIONS__ = {
        injectTopBar: true,
        fileHintHtml: `
            <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;">
                <div>
                    <div style="font-weight:700;margin-bottom:4px;">i18n 资源加载失败</div>
                    <div>你正在以 <code style="color:#fcd34d;">file://</code> 方式打开页面，浏览器会拦截对本地 <code style="color:#fcd34d;">i18n/*.json</code> 的 <code style="color:#fcd34d;">fetch</code>。</div>
                    <div>请使用本地 HTTP 服务打开（例如运行 <code style="color:#fcd34d;">node other-tool/dev-server.js</code>，然后访问 <code style="color:#fcd34d;">http://127.0.0.1:4173/...</code>）。</div>
                </div>
                <button type="button" aria-label="close" style="cursor:pointer;background:transparent;border:0;color:#fbbf24;font-weight:700;font-size:14px;line-height:1;">×</button>
            </div>
        `
    };

    const coreUrl = new URL('../tools-common/i18n-helper.js', baseUrl).href;
    if (!document.querySelector('script[data-tb-i18n-core="true"]')) {
        const script = document.createElement('script');
        script.src = coreUrl;
        script.dataset.tbI18nCore = 'true';
        document.head.appendChild(script);
    }
})();
