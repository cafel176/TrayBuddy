(function () {
  if (window.downloadBlob) return;

  function normalizeOptions(options) {
    if (!options || typeof options !== 'object') return {};
    return options;
  }

  window.downloadBlob = function downloadBlob(blob, filename, options) {
    if (!blob) return;

    const opts = normalizeOptions(options);
    const revokeDelay = Number.isFinite(opts.revokeDelay) ? opts.revokeDelay : 1000;
    const appendToBody = opts.appendToBody !== false;

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || 'download';

    if (appendToBody) {
      document.body.appendChild(a);
    }

    a.click();

    if (appendToBody) {
      a.remove();
    }

    const delay = Math.max(0, revokeDelay || 0);
    if (delay > 0) {
      setTimeout(() => URL.revokeObjectURL(url), delay);
    } else {
      URL.revokeObjectURL(url);
    }
  };
})();
