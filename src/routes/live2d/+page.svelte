<!--
========================================================================= 
Live2D 窗口页面 (+page.svelte)
=========================================================================

当前占位：暂不渲染任何内容，仅作为空窗口。
========================================================================= 
-->

<div class="live2d-window"></div>

<style>
  :global(html),
  :global(body) {
    margin: 0;
    padding: 0;
    overflow: hidden;
    background-color: transparent;
    width: 100%;
    height: 100%;
  }

  .live2d-window {
    width: 100%;
    height: 100%;
  }
</style>
