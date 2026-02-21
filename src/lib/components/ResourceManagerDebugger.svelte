<!--
========================================================================= 
闁荤姍鍐仾缂侇煈鍠氱划濠氭晬閸曨剙鈧偤鎮圭€ｎ亜鏆㈤柣锔诲灣缁辨帡宕熼鍜佸仺 (ResourceManagerDebugger.svelte)
=========================================================================

闂佸憡姊婚崰鏇㈠礂濡警娼￠柛灞剧箓閻?
- 闁诲繒鍋炲ú婊堝Φ濮樿泛妞界€光偓閳ь剟顢橀幖浣瑰仩?Mod 闁荤姍鍐仾缂侇煈鍠氶崠鏍嚒閵堝洤鐓?
- 闂佸憡甯楅〃鍛村吹椤撱垹鐭楁い鏍ㄧ矋閺嗗繘鏌?Mod 濡ょ姷鍋犻崺鏍极椤曗偓楠炴劖鎷呯粙娆炬奖闁?闂佸憡顨嗛悺鏇灻?
- 闁荤姴娴勬俊鍥╁垝韫囨洑娌柡鍥╁О娴犳稓鎲搁悧鍫熷碍濠⒀呭█瀹曟繈鎮╅悜妯笺偘 Mod 闂佹眹鍔岀€氼厽鏅跺澶婂珘濠㈣泛娴烽妶顐ｇ節?
  - Manifest 闂備焦婢樼粔鍫曟偪閸℃ḿ鈹嶉柍鈺佸暕缁?
  - 闁荤喐鐟︾敮鐔哥珶婵犲啰鈹嶉柍鈺佸暕缁?(婵犮垼鍩栨穱娲敋閵忋垺鍤婇柍?
  - 闂傚倸鐗婇悷锕傚焵椤戣法顦︽繛瀛橈耿閹囧炊椤忓棎鍋掑┑鐘欏嫬濮х紒杈ㄧ懅閺侇噣鏁傞崜褏绀嗛梺浼欑祷閸庡崬霉濡紮绱ｉ柛鏇ㄥ櫘濞兼棃鏌涘⿰鍐╂拱闁哄倷鐒﹀鍕槻濠殿喗鐩幊妤呭棘閵堝洨顦?
  - 闁瑰吋娼欑换鎰板垂椤忓牆绀夐柕濞у嫭姣庨柣鐘欏啫顏紒顭戝櫍閺佸秹宕煎┑鍫熸殧缂傚倸鍊甸弲婵嬪汲閹版澘鐐婂Δ锝呭枤閺嗘洟鎮峰▎蹇曞⒊缂?
  - 闁荤姴娴傞崣鍐偂閸撲焦灏庨柛鏇ㄥ墰閻栭亶鏌ㄥ☉妯煎闁汇埄鍋婇獮姗€顢橀悢鍛婃緬闂佸憡姊婚崰鏇㈠礂濮椻偓閺?
  - 闁诲海鏁搁、濠囨儊娴犲妫橀柛銉ｅ妽閹烽亶鎮硅鐎氼厾鑺?

闂佽桨鑳舵晶妤€鐣垫担璇?
- get_mod_search_paths: 闂佸吋鍎抽崲鑼躲亹?Mod 闂佺懓鍚嬬划搴ㄥ磼閵娧勫磯妞ゆ牗姘ㄧ粣?
- get_available_mods: 闂佸吋鍎抽崲鑼躲亹閸ヮ剙鐭楁い鏍ㄧ矋閺?Mod 闂佸憡甯楅〃澶愬Υ?
- get_current_mod: 闂佸吋鍎抽崲鑼躲亹閸ヮ亗浜归柟鎯у暱椤ゅ懐鈧懓鎲¤ぐ鍐╂叏閻愬瓨濮滈柣锝呮湰閻?Mod
- load_mod: 闂佸憡姊绘慨鎯归崶顒€绠伴柛銉戝懏姣?Mod
- unload_mod: 闂佸憡顨嗛悺鏇灻归崶顏備汗闁规儳鍟块·?Mod
=========================================================================
-->

<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { onMount, onDestroy } from "svelte";
  import { loadBubbleStyle } from "$lib/bubble/bubbleStyle";
  import { t, onLangChange } from "$lib/i18n";
  import { buildModAssetUrl } from "$lib/utils/modAssetUrl";
  import type {
    AssetInfo,
    AudioInfo,
    BorderConfig,
    CharacterConfig,
    Live2DConfig,
    ModType,
    PngRemixConfig,
    ThreeDConfig,
    StateInfo,
    TriggerInfo,
  } from "$lib/types/asset";



  // ======================================================================= //
  // 缂備緡鍋夐褔鎮楁搴樺亾鐟欏嫮鐓紒?
  // ======================================================================= //

  interface ModManifest {
    id: string;
    version: string;
    author: string;
    mod_type?: ModType;
    default_audio_lang_id: string;
    default_text_lang_id: string;
    character: CharacterConfig;
    border: BorderConfig;
    show_mod_data_panel: boolean;
    mod_data_default_int: number;
    global_keyboard: boolean;
    global_mouse: boolean;
    important_states: Record<string, StateInfo>;
    states: StateInfo[];
    triggers: TriggerInfo[];
  }


  interface TextInfo {

    name: string;
    text: string;
    duration: number;
  }

  interface CharacterInfo {
    name: string;
    lang: string;
    id: string;
    description: string;
  }

  interface ModInfo {
    path: string;
    bubble_style?: string;
    icon_path?: string;
    preview_path?: string;
    manifest: ModManifest;
    imgs: AssetInfo[];
    sequences: AssetInfo[];
    live2d?: Live2DConfig;
    pngremix?: PngRemixConfig;
    threed?: ThreeDConfig;
    audios: Record<string, AudioInfo[]>;
    texts: Record<string, TextInfo[]>;
    info: Record<string, CharacterInfo>;
  }



  // ======================================================================= //
  // 闂佸憡绻傜粔瀵歌姳閹绘帩鍤曢煫鍥ㄦ礀绗戦梺?
  // ======================================================================= //

  let searchPaths: string[] = $state([]);
  let mods: string[] = $state([]);
  let selectedMod = $state("");
  let statusMsg = $state(t("resource.statusWaiting"));
  let currentModInfo = $state<ModInfo | null>(null);
  let loading = $state(false);

  // i18n 闂佸憡绻傜粔瀵歌姳閹绘帩鍤曢煫鍥ㄦ礀椤ｅジ鏌￠崼顐㈠鐟?
  let _langVersion = $state(0);
  let unsubLang: (() => void) | null = null;

  // 闂佸憡绻傜粔瀵歌姳閹绘帩鍤曢煫鍥ㄦ礈閸婃娊鎮归崶銊ョ仴闁搞倝浜跺?
  function _(key: string, params?: Record<string, string | number>): string {
    void _langVersion;
    return t(key, params);
  }

  /** 濠碘槅鍋€閸嬫捇鏌＄仦璇插姢濠殿喗鎮傞獮鈧ù锝呮贡鍟搁梺璇″弾閸ㄥ崬危閹间礁瑙﹂柨鏇楀亾閻庡灚锕㈠畷銉╊敃閿旇姤娅撻柣鐘叉祩閸垱绌辨繝鍥х畳?*/
  function isError(msg: string): boolean {
    return (
      msg.includes(_("common.failed")) ||
      msg.includes("failed") ||
      msg.includes("失败")
    );
  }


  const I32_MIN = -2147483648;
  const I32_MAX = 2147483647;

  function formatTriggerCounterRange(start?: number, end?: number): string {
    const s = Number.isFinite(Number(start)) ? Number(start) : I32_MIN;
    const e = Number.isFinite(Number(end)) ? Number(end) : I32_MAX;

    const sText = s <= I32_MIN ? "*" : String(s);
    const eText = e >= I32_MAX ? "*" : String(e);
    return `[${sText}, ${eText}]`;
  }

  function formatTempRange(start?: number, end?: number): string {
    const sText = start != null ? `${start}°C` : "*";
    const eText = end != null ? `${end}°C` : "*";
    return `[${sText}, ${eText}]`;
  }


  function formatMouthState(ms?: 0 | 1 | 2): string {
    switch (ms) {
      case 0: return _("resource.pngremixMouthStateClosed");
      case 1: return _("resource.pngremixMouthStateOpen");
      case 2: return _("resource.pngremixMouthStateScreaming");
      default: return _("resource.pngremixMouthStateInherit");
    }
  }


  // 闂佹悶鍎辨晶鑺ユ櫠閺嶎厼钃熼柕澹嫮鐣介梺闈╃祷閸斿孩鎱ㄩ幖浣哥畱?
  let viewerVisible = $state(false);
  let viewerImageSrc = $state("");
  let viewerImageTitle = $state("");

  // 闂傚倸锕ユ繛濠囥€傞崼鏇炵妞ゆ挾鍠愰弶褰掓煟濡灝鐓愰柍?
  let currentAudio: HTMLAudioElement | null = null;
  let playingAudioName = $state<string | null>(null);

  // ======================================================================= //
  // 闂佽桨鑳舵晶妤€鐣垫笟鈧獮娆忣吋閸曨厾鈻曢梺鍛婂灱婵倝寮?
  // ======================================================================= //

  async function refreshMods() {
    try {
      searchPaths = await invoke("get_mod_search_paths");
      mods = await invoke("get_available_mods");

      const info = (await invoke("get_current_mod")) as ModInfo | null;
      if (info) {
        currentModInfo = info;
        // 缂傚倷鑳堕崰宥囩博鐎涙ɑ濯撮悹鎭掑妽閺?manifest.id 婵炶揪绲剧划鍫㈡嫻閻旂厧鑸规い鏍ㄧ懅椤忛亶鏌″鍛┛闁?
        selectedMod = info.manifest.id;
        statusMsg = _("resource.statusCurrentLoaded") + " " + info.manifest.id;
      } else {
        statusMsg = _("resource.statusRefreshed", { count: mods.length });
        if (mods.length > 0 && !selectedMod) {
          selectedMod = mods[0];
        }
      }
    } catch (e) {
      statusMsg = _("resource.statusRefreshFailed") + " " + e;
    }
  }

  async function loadSelectedMod() {
    if (!selectedMod) {
      statusMsg = _("resource.statusSelectMod");
      return;
    }
    loading = true;
    statusMsg = _("resource.statusLoading");
    try {
      const info = (await invoke("load_mod", {
        modId: selectedMod,
      })) as ModInfo;
      currentModInfo = info;
      statusMsg = _("resource.statusLoadSuccessTpl", {
        id: info.manifest.id,
        version: info.manifest.version,
      });
      // 闂備焦褰冪粔鐢稿蓟婵犲洤绀夐柣妯煎劋缁佺増鎱ㄥΟ缁樷拹闁革附妞藉钘夌暋閹殿喚顢?
      await loadBubbleStyle();
    } catch (e) {
      statusMsg = _("resource.statusLoadFailed") + " " + e;
      currentModInfo = null;
    } finally {
      loading = false;
    }
  }

  async function unloadMod() {
    try {
      const success = await invoke("unload_mod");
      if (success) {
        statusMsg = _("resource.statusUnloaded");
        currentModInfo = null;
      } else {
        statusMsg = _("resource.statusNoMod");
      }
    } catch (e) {
      statusMsg = _("resource.statusUnloadFailed") + " " + e;
    }
  }

  async function openAssetFile(relativePath: string) {
    if (!currentModInfo) return;
    try {
      const fullPath = `${currentModInfo.path}/${relativePath}`.replace(
        /\//g,
        "\\",
      );
      await invoke("open_path", { path: fullPath });
    } catch (e) {
      statusMsg = _("resource.statusOpenFailed") + " " + e;
    }
  }

  // ======================================================================= //
  // 闂佹悶鍎辨晶鑺ユ櫠閺嶎厼钃熼柕澹嫮鐣介梺?
  // ======================================================================= //

  function getAssetSrc(relativePath: string): string {
    if (!currentModInfo) return "";
    return buildModAssetUrl(currentModInfo.path, relativePath);
  }

  function openImageViewer(src: string, title: string) {
    viewerImageSrc = src;
    viewerImageTitle = title;
    viewerVisible = true;
  }

  function closeImageViewer() {
    viewerVisible = false;
  }

  // ======================================================================= //
  // 闂傚倸锕ユ繛濠囥€傞崼鏇炵妞ゆ挾鍠愰弶?
  // ======================================================================= //

  function playAudio(audioPath: string, audioName: string) {
    // 闂佺ǹ顑嗙划宥夘敆濞戞嚎浜归柟鎯у暱椤ゅ懘鏌熺紒銏犲箺闁?
    if (currentAudio) {
      currentAudio.pause();
      currentAudio = null;
    }

    // 婵犵鈧啿鈧綊鎮樻径鎰€烽柣鐔告緲濮ｅ﹪鏌ｉ妸銉ヮ仾婵″弶鐡曢妵鎰板箻閸愬樊鏋€濠殿喗绻愮徊钘夛耿椤忓牆绠绘い鎾跺枑閺夊綊鏌ｉ妸銉ヮ伒缂佽鲸绻堝畷鎴濃堪閸曢潧澹橀梺鍦檸閸樹粙寮?
    if (playingAudioName === audioName) {
      playingAudioName = null;
      return;
    }

    if (!currentModInfo) return;

    const src = buildModAssetUrl(currentModInfo.path, `audio/${audioPath}`);

    currentAudio = new Audio(src);
    playingAudioName = audioName;

    currentAudio.onended = () => {
      playingAudioName = null;
      currentAudio = null;
    };

    currentAudio.onerror = () => {
      statusMsg = _("resource.statusPlayFailed") + " " + audioName;
      playingAudioName = null;
      currentAudio = null;
    };

    currentAudio.play();
  }

  function stopAudio() {
    if (currentAudio) {
      currentAudio.pause();
      currentAudio = null;
      playingAudioName = null;
    }
  }

  // ======================================================================= //
  // Mod 缂備緡鍋夐褔鎮?
  // ======================================================================= //

  function getModType(): ModType {
    return (currentModInfo?.manifest.mod_type ?? "sequence") as ModType;
  }

  function getModTypeLabel(): string {
    switch (getModType()) {
      case "live2d":
        return _("resource.modTypeLive2D");
      case "pngremix":
        return _("resource.modTypePngRemix");
      case "3d":
        return "3D";
      default:
        return _("resource.modTypeSequence");
    }
  }

  function isLive2dMod(): boolean {
    return getModType() === "live2d";
  }

  function isPngremixMod(): boolean {
    return getModType() === "pngremix";
  }

  function isSequenceMod(): boolean {
    return getModType() === "sequence";
  }

  function isThreeDMod(): boolean {
    return getModType() === "3d";
  }

  // ======================================================================= //
  // 缂傚倷鑳堕崰鏇㈩敇?
  // ======================================================================= //


  function getTotalStates(): number {
    if (!currentModInfo) return 0;
    return (
      Object.keys(currentModInfo.manifest.important_states).length +
      currentModInfo.manifest.states.length
    );
  }

  function getTotalAudios(): number {
    if (!currentModInfo) return 0;
    return Object.values(currentModInfo.audios).flat().length;
  }

  function getTotalTexts(): number {
    if (!currentModInfo) return 0;
    return Object.values(currentModInfo.texts).flat().length;
  }

  // 闂佸憡甯掑Λ娑氭偖椤愶附鍋愰柤鍝ヮ暯閸嬫挻鎷呴悿顖滎槹闂佸綊鏅插鎺旂不濞嗘挸妞界€光偓閸曨剙顫￠梺褰掓櫜濡炴帞绮?
  function getImportantStatesByPersistence(): {
    persistent: [string, StateInfo][];
    nonPersistent: [string, StateInfo][];
  } {
    if (!currentModInfo) return { persistent: [], nonPersistent: [] };
    const entries = Object.entries(currentModInfo.manifest.important_states);
    return {
      persistent: entries.filter(([_, s]) => s.persistent),
      nonPersistent: entries.filter(([_, s]) => !s.persistent),
    };
  }

  function getOtherStatesByPersistence(): {
    persistent: StateInfo[];
    nonPersistent: StateInfo[];
  } {
    if (!currentModInfo) return { persistent: [], nonPersistent: [] };
    return {
      persistent: currentModInfo.manifest.states.filter((s) => s.persistent),
      nonPersistent: currentModInfo.manifest.states.filter(
        (s) => !s.persistent,
      ),
    };
  }

  // ======================================================================= //
  // 闂佹眹鍨婚崰搴ㄥ箠閿熺姴宸濋柕濠忛檮閸?
  // ======================================================================= //

  onMount(() => {
    refreshMods();
    unsubLang = onLangChange(() => {
      _langVersion++;
    });
  });

  onDestroy(() => {
    stopAudio();
    unsubLang?.();
  });
</script>

<!-- ======================================================================= -->
<!-- 缂傚倷绀佺€氼亜鈻庨姀鐘栫喖鍩勯崘鈺冨嚒 -->
<!-- ======================================================================= -->

<div class="debug-panel">
  <h3>{_("resource.title")}</h3>

  <!-- 闂佺懓鍚嬬划搴ㄥ磼閵娧勫磯妞ゆ牗姘ㄧ粣鐐睬庨崶锝呭⒉濞?-->
  <div class="path-info">
    <strong>{_("resource.searchPaths")}</strong>
    {#each searchPaths as path}
      <div class="path-item">{path}</div>
    {/each}
  </div>

  <!-- Mod 闁荤姴娴勯梽鍕磿韫囨稒顥堥柕蹇婂墲缁?-->
  {#if currentModInfo}
    <div class="info-panel">
      <div class="info-header">
        <h4>{_("resource.modDetails")}</h4>
        <div class="path-badge" title={currentModInfo.path}>
          {currentModInfo.path.split(/[\\/]/).pop()}
        </div>
      </div>

      <!-- 缂傚倷鑳堕崰鏇㈩敇缁嬫娼￠柛灞剧箥濞?-->
      <div class="stats-bar">
        <div class="stat-item">
          <span class="stat-value">{getTotalStates()}</span>
          <span class="stat-label">{_("resource.statStates")}</span>
        </div>
        <div class="stat-item">
          <span class="stat-value"
            >{currentModInfo.manifest.triggers.length}</span>
          <span class="stat-label">{_("resource.statTriggers")}</span>
        </div>
        {#if isLive2dMod()}
          <div class="stat-item">
            <span class="stat-value">{currentModInfo.live2d?.motions.length ?? 0}</span>
            <span class="stat-label">{_("resource.statLive2DMotions")}</span>
          </div>
          <div class="stat-item">
            <span class="stat-value">{currentModInfo.live2d?.expressions.length ?? 0}</span>
            <span class="stat-label">{_("resource.statLive2DExpressions")}</span>
          </div>
          <div class="stat-item">
            <span class="stat-value">{currentModInfo.live2d?.states.length ?? 0}</span>
            <span class="stat-label">{_("resource.statLive2DStates")}</span>
          </div>
        {:else if isPngremixMod()}
          <div class="stat-item">
            <span class="stat-value">{currentModInfo.pngremix?.expressions.length ?? 0}</span>
            <span class="stat-label">{_("resource.statPngRemixExpressions")}</span>
          </div>
          <div class="stat-item">
            <span class="stat-value">{currentModInfo.pngremix?.motions.length ?? 0}</span>
            <span class="stat-label">{_("resource.statPngRemixMotions")}</span>
          </div>
          <div class="stat-item">
            <span class="stat-value">{currentModInfo.pngremix?.states.length ?? 0}</span>
            <span class="stat-label">{_("resource.statPngRemixStates")}</span>
          </div>
        {:else if isThreeDMod()}
          <div class="stat-item">
            <span class="stat-value">{currentModInfo.threed?.animations.length ?? 0}</span>
            <span class="stat-label">{_("resource.statThreeDAnimations")}</span>
          </div>
        {:else}
          <div class="stat-item">
            <span class="stat-value">{currentModInfo.imgs.length}</span>
            <span class="stat-label">{_("resource.statImages")}</span>
          </div>
          <div class="stat-item">
            <span class="stat-value">{currentModInfo.sequences.length}</span>
            <span class="stat-label">{_("resource.statAnimations")}</span>
          </div>
        {/if}

        <div class="stat-item">
          <span class="stat-value">{getTotalAudios()}</span>
          <span class="stat-label">{_("resource.statAudios")}</span>
        </div>
        <div class="stat-item">
          <span class="stat-value">{getTotalTexts()}</span>
          <span class="stat-label">{_("resource.statTexts")}</span>
        </div>
      </div>

      <div class="tabs">
        <!-- 闂佺硶鏅濋崕銈咃耿閻楀牏鈹嶉柍鈺佸暕缁?(Manifest) -->
        <details open>
          <summary>{_("resource.basicInfo")}</summary>
          <div class="tab-content">
            <div class="info-grid">
              <div class="info-row">
                <span class="info-label">{_("resource.id")}</span>
                <span class="info-value">{currentModInfo.manifest.id}</span>
              </div>
              <div class="info-row">
                <span class="info-label">{_("resource.version")}</span>
                <span class="info-value">{currentModInfo.manifest.version}</span>
              </div>
              <div class="info-row">
                <span class="info-label">{_("resource.author")}</span>
                <span class="info-value">{currentModInfo.manifest.author}</span>
              </div>
              <div class="info-row">
                <span class="info-label">{_("resource.modType")}</span>
                <span class="info-value">{getModTypeLabel()}</span>
              </div>

              <div class="info-row">
                <span class="info-label">{_("resource.bubbleStyle")}</span>
                <span class="info-value"
                  >{currentModInfo.bubble_style || _("resource.notSet")}</span>
              </div>
              <div class="info-row">
                <span class="info-label">{_("resource.iconPath")}</span>
                <span class="info-value"
                  >{currentModInfo.icon_path || _("resource.notSet")}</span>
              </div>
              <div class="info-row">
                <span class="info-label">{_("resource.previewPath")}</span>
                <span class="info-value"
                  >{currentModInfo.preview_path || _("resource.notSet")}</span>
              </div>
              <div class="info-row">
                <span class="info-label">{_("resource.defaultAudio")}</span>

                <span class="info-value"
                  >{currentModInfo.manifest.default_audio_lang_id}</span>
              </div>
              <div class="info-row">
                <span class="info-label">{_("resource.defaultText")}</span>
                <span class="info-value"
                  >{currentModInfo.manifest.default_text_lang_id}</span>
              </div>
              <div class="info-row">
                <span class="info-label">{_("resource.showModDataPanel")}</span>
                <span class="info-value"
                  >{currentModInfo.manifest.show_mod_data_panel ? _("common.yes") : _("common.no")}</span>
              </div>
              <div class="info-row">
                <span class="info-label">{_("resource.modDataDefaultInt")}</span>
                <span class="info-value"
                  >{currentModInfo.manifest.mod_data_default_int}</span>
              </div>
              <div class="info-row">
                <span class="info-label">{_("resource.globalKeyboard")}</span>
                <span class="info-value"
                  >{currentModInfo.manifest.global_keyboard ? _("common.yes") : _("common.no")}</span>
              </div>
              <div class="info-row">
                <span class="info-label">{_("resource.globalMouse")}</span>
                <span class="info-value"
                  >{currentModInfo.manifest.global_mouse ? _("common.yes") : _("common.no")}</span>
              </div>
            </div>


            {#if isSequenceMod()}
            <h5>{_("resource.characterConfig")}</h5>
            <div class="info-grid compact">
              <div class="info-row">
                <span class="info-label">{_("resource.zOffset")}</span>
                <span class="info-value"
                  >{currentModInfo.manifest.character.z_offset}</span>
              </div>

              <div class="info-row">
                <span class="info-label">{_("resource.canvasFitPreference")}</span>
                <span class="info-value"
                  >{currentModInfo.manifest.character.canvas_fit_preference ??
                    _("resource.notSet")}</span>
              </div>


            </div>

            <h5>{_("resource.borderConfig")}</h5>
            <div class="info-grid compact">
              <div class="info-row">
                <span class="info-label">{_("resource.enable")}</span>
                <span class="info-value"
                  >{currentModInfo.manifest.border.enable
                    ? _("common.yes")
                    : _("common.no")}</span>
              </div>
              <div class="info-row">
                <span class="info-label">{_("resource.animation")}</span>
                <span class="info-value"
                  >{currentModInfo.manifest.border.anima ||
                    _("resource.notSet")}</span>
              </div>
              <div class="info-row">
                <span class="info-label">{_("resource.zOffset")}</span>
                <span class="info-value"
                  >{currentModInfo.manifest.border.z_offset}</span>
              </div>

            </div>
            {/if}
          </div>
        </details>

        <!-- 闁荤喐鐟︾敮鐔哥珶婵犲啰鈹嶉柍鈺佸暕缁?(婵犮垼鍩栨穱娲敋閵忋垺鍤婇柍? -->
        <details>
          <summary
            >{_("resource.characterInfo", {
              lang: Object.keys(currentModInfo.info).length,
            })}</summary
          >
          <div class="tab-content">
            <div class="lang-cards">
              {#each Object.entries(currentModInfo.info) as [lang, info]}
                <div class="lang-card">
                  <span class="lang-code">{lang}</span>
                  <div class="lang-info">
                    <div class="char-name">{info.name}</div>
                    <div class="char-meta">
                      <span>{_("resource.langLabel")} {info.lang}</span>
                      <span>{_("resource.id")}: {info.id}</span>
                    </div>

                    {#if info.description}
                      <div class="char-desc">{info.description}</div>
                    {/if}
                  </div>
                </div>
              {/each}
            </div>
          </div>
        </details>

        <!-- 闂佸搫绉舵灙缂佹椽绠栭幃鈺呮嚋绾版ê浜?-->
        <details>
          <summary
            >{_("resource.coreStates")} ({Object.keys(
              currentModInfo.manifest.important_states,
            ).length})</summary
          >
          <div class="tab-content">
            {#if getImportantStatesByPersistence().persistent.length > 0}
              <details class="state-category" open>
                <summary class="category-summary persistent-cat">
                  {_("resource.persistentStates")} ({getImportantStatesByPersistence()
                    .persistent.length})
                </summary>
                <div class="state-list">
                  {#each getImportantStatesByPersistence().persistent as [name, state]}
                    <div class="state-card persistent">
                      <div class="state-header">
                        <span class="state-name">{name}</span>
                        <span class="badge persistent"
                          >{_("resource.persistent")}</span>
                        {#if state.priority > 0}
                          <span class="badge priority"
                            >{_("resource.priority")} {state.priority}</span>
                        {/if}
                      </div>
                      <div class="state-detail">
                        {#if state.anima}<div class="detail-item">
                            <span class="detail-label"
                              >{_("resource.animationLabel")}</span>
                            {state.anima}
                          </div>{/if}
                        {#if state.audio}<div class="detail-item">
                            <span class="detail-label"
                              >{_("resource.audioLabel")}</span>
                            {state.audio}
                          </div>{/if}
                        {#if state.text}<div class="detail-item">
                            <span class="detail-label"
                              >{_("resource.textLabel")}</span>
                            {state.text}
                          </div>{/if}
                        {#if state.next_state}<div class="detail-item">
                            <span class="detail-label"
                              >{_("resource.nextLabel")}</span>
                            {state.next_state}
                          </div>{/if}
                        {#if state.date_start || state.date_end}
                          <div class="detail-item">
                            <span class="detail-label"
                              >{_("resource.dateLabel")}</span>
                            {state.date_start || "*"} ~ {state.date_end || "*"}
                          </div>
                        {/if}
                        {#if state.time_start || state.time_end}
                          <div class="detail-item">
                            <span class="detail-label"
                              >{_("resource.timeLabel")}</span>
                            {state.time_start || "*"} ~ {state.time_end || "*"}
                          </div>
                        {/if}
                        {#if (state.trigger_time ?? 0) > 0}
                          <div class="detail-item">
                            <span class="detail-label"
                              >{_("resource.timerLabel")}</span>
                            {_("resource.timerDesc", {
                              interval: state.trigger_time ?? 0,
                              chance: ((state.trigger_rate ?? 0) * 100).toFixed(0),
                            })}
                          </div>
                        {/if}

                        {#if state.mod_data_counter}
                          <div class="detail-item">
                            <span class="detail-label">{_("resource.modDataCounter")}</span>
                            <span class="tag counter-tag">{state.mod_data_counter.op} {state.mod_data_counter.value}</span>
                          </div>
                        {/if}
                        <div class="detail-item">
                          <span class="detail-label">{_("resource.triggerCounterRange")}</span>
                          <span class="tag counter-tag">{formatTriggerCounterRange(state.trigger_counter_start, state.trigger_counter_end)}</span>
                        </div>
                        {#if state.trigger_temp_start != null || state.trigger_temp_end != null}
                          <div class="detail-item">
                            <span class="detail-label">{_("resource.triggerTempRange")}</span>
                            <span class="tag counter-tag">{formatTempRange(state.trigger_temp_start, state.trigger_temp_end)}</span>
                          </div>
                        {/if}
                        {#if state.trigger_uptime}
                          <div class="detail-item">
                            <span class="detail-label">{_("resource.triggerUptime")}</span>
                            {state.trigger_uptime} {_("resource.minutes")}
                          </div>
                        {/if}
                        {#if state.trigger_weather && state.trigger_weather.length > 0}
                          <div class="detail-item">
                            <span class="detail-label">{_("resource.triggerWeather")}</span>
                            <div class="tag-list">
                              {#each state.trigger_weather as w}
                                <span class="tag state-tag">{w}</span>
                              {/each}
                            </div>
                          </div>
                        {/if}
                        {#if state.live2d_params && state.live2d_params.length > 0}
                          <div class="detail-item">
                            <span class="detail-label">{_("resource.live2dParamsOverride")}</span>
                            <div class="tag-list">
                              {#each state.live2d_params as p}
                                <span class="tag state-tag">{p.id}: {p.value}{p.target === "PartOpacity" ? " (Part)" : ""}</span>
                              {/each}
                            </div>
                          </div>
                        {/if}
                        {#if state.pngremix_params && state.pngremix_params.length > 0}
                          <div class="detail-item">
                            <span class="detail-label">{_("resource.pngremixParamsOverride")}</span>
                            <div class="tag-list">
                              {#each state.pngremix_params as p}
                                <span class="tag state-tag">{p.type}: {p.name}</span>
                              {/each}
                            </div>
                          </div>
                        {/if}
                        {#if state.branch_show_bubble === false}
                          <div class="detail-item">
                            <span class="detail-label">{_("resource.branchShowBubble")}</span>
                            {_("common.no")}
                          </div>
                        {/if}

                        {#if state.can_trigger_states && state.can_trigger_states.length > 0}

                          <div class="detail-item">
                            <span class="detail-label"
                              >{_("resource.triggerable")}</span>
                            <div class="tag-list">
                              {#each state.can_trigger_states as s}
                                <span class="tag state-tag">{s.state}{(s.weight ?? 1) !== 1 ? `(${s.weight})` : ""}</span>
                              {/each}
                            </div>
                          </div>
                        {/if}

                        {#if state.branch && state.branch.length > 0}
                          <div class="detail-item">
                            <span class="detail-label"
                              >{_("resource.branchLabel")}</span>
                            <div class="branch-list">
                              {#each state.branch as b}
                                <div class="branch-item">
                                  <span class="branch-text">{b.text}</span>
                                  <span class="branch-arrow">→</span>
                                  <span class="branch-next">{b.next_state}</span>
                                </div>
                              {/each}
                            </div>
                          </div>
                        {/if}
                      </div>
                    </div>
                  {/each}
                </div>
              </details>
            {/if}
            {#if getImportantStatesByPersistence().nonPersistent.length > 0}

              <details class="state-category" open>
                <summary class="category-summary non-persistent-cat">
                  {_("resource.nonPersistentStates")} ({getImportantStatesByPersistence()
                    .nonPersistent.length})
                </summary>
                <div class="state-list">
                  {#each getImportantStatesByPersistence().nonPersistent as [name, state]}
                    <div class="state-card">
                      <div class="state-header">
                        <span class="state-name">{name}</span>
                        {#if state.priority > 0}
                          <span class="badge priority"
                            >{_("resource.priority")} {state.priority}</span>
                        {/if}
                      </div>
                      <div class="state-detail">
                        {#if state.anima}<div class="detail-item">
                            <span class="detail-label"
                              >{_("resource.animationLabel")}</span>
                            {state.anima}
                          </div>{/if}
                        {#if state.audio}<div class="detail-item">
                            <span class="detail-label"
                              >{_("resource.audioLabel")}</span>
                            {state.audio}
                          </div>{/if}
                        {#if state.text}<div class="detail-item">
                            <span class="detail-label"
                              >{_("resource.textLabel")}</span>
                            {state.text}
                          </div>{/if}
                        {#if state.next_state}<div class="detail-item">
                            <span class="detail-label"
                              >{_("resource.nextLabel")}</span>
                            {state.next_state}
                          </div>{/if}
                        {#if state.date_start || state.date_end}
                          <div class="detail-item">
                            <span class="detail-label"
                              >{_("resource.dateLabel")}</span>
                            {state.date_start || "*"} ~ {state.date_end || "*"}
                          </div>
                        {/if}
                        {#if state.time_start || state.time_end}
                          <div class="detail-item">
                            <span class="detail-label"
                              >{_("resource.timeLabel")}</span>
                            {state.time_start || "*"} ~ {state.time_end || "*"}
                          </div>
                        {/if}
                        {#if (state.trigger_time ?? 0) > 0}
                          <div class="detail-item">
                            <span class="detail-label"
                              >{_("resource.timerLabel")}</span>
                            {_("resource.timerDesc", {
                              interval: state.trigger_time ?? 0,
                              chance: ((state.trigger_rate ?? 0) * 100).toFixed(0),
                            })}
                          </div>
                        {/if}

                        {#if state.mod_data_counter}
                          <div class="detail-item">
                            <span class="detail-label">{_("resource.modDataCounter")}</span>
                            <span class="tag counter-tag">{state.mod_data_counter.op} {state.mod_data_counter.value}</span>
                          </div>
                        {/if}
                        <div class="detail-item">
                          <span class="detail-label">{_("resource.triggerCounterRange")}</span>
                          <span class="tag counter-tag">{formatTriggerCounterRange(state.trigger_counter_start, state.trigger_counter_end)}</span>
                        </div>
                        {#if state.trigger_temp_start != null || state.trigger_temp_end != null}
                          <div class="detail-item">
                            <span class="detail-label">{_("resource.triggerTempRange")}</span>
                            <span class="tag counter-tag">{formatTempRange(state.trigger_temp_start, state.trigger_temp_end)}</span>
                          </div>
                        {/if}
                        {#if state.trigger_uptime}
                          <div class="detail-item">
                            <span class="detail-label">{_("resource.triggerUptime")}</span>
                            {state.trigger_uptime} {_("resource.minutes")}
                          </div>
                        {/if}
                        {#if state.trigger_weather && state.trigger_weather.length > 0}
                          <div class="detail-item">
                            <span class="detail-label">{_("resource.triggerWeather")}</span>
                            <div class="tag-list">
                              {#each state.trigger_weather as w}
                                <span class="tag state-tag">{w}</span>
                              {/each}
                            </div>
                          </div>
                        {/if}
                        {#if state.live2d_params && state.live2d_params.length > 0}
                          <div class="detail-item">
                            <span class="detail-label">{_("resource.live2dParamsOverride")}</span>
                            <div class="tag-list">
                              {#each state.live2d_params as p}
                                <span class="tag state-tag">{p.id}: {p.value}{p.target === "PartOpacity" ? " (Part)" : ""}</span>
                              {/each}
                            </div>
                          </div>
                        {/if}
                        {#if state.pngremix_params && state.pngremix_params.length > 0}
                          <div class="detail-item">
                            <span class="detail-label">{_("resource.pngremixParamsOverride")}</span>
                            <div class="tag-list">
                              {#each state.pngremix_params as p}
                                <span class="tag state-tag">{p.type}: {p.name}</span>
                              {/each}
                            </div>
                          </div>
                        {/if}
                        {#if state.branch_show_bubble === false}
                          <div class="detail-item">
                            <span class="detail-label">{_("resource.branchShowBubble")}</span>
                            {_("common.no")}
                          </div>
                        {/if}

                        {#if state.can_trigger_states && state.can_trigger_states.length > 0}

                          <div class="detail-item">
                            <span class="detail-label"
                              >{_("resource.triggerable")}</span>
                            <div class="tag-list">
                              {#each state.can_trigger_states as s}
                                <span class="tag state-tag">{s.state}{(s.weight ?? 1) !== 1 ? `(${s.weight})` : ""}</span>
                              {/each}
                            </div>
                          </div>
                        {/if}
                        {#if state.branch && state.branch.length > 0}
                          <div class="detail-item">
                            <span class="detail-label"
                              >{_("resource.branchLabel")}</span>
                            <div class="branch-list">
                              {#each state.branch as b}
                                <div class="branch-item">
                                  <span class="branch-text">{b.text}</span>
                                  <span class="branch-arrow">→</span>
                                  <span class="branch-next">{b.next_state}</span>
                                </div>
                              {/each}
                            </div>
                          </div>
                        {/if}
                      </div>
                    </div>
                  {/each}
                </div>
              </details>
            {/if}
          </div>
        </details>

        <!-- 闂佺ǹ绻戝﹢鍦垝椤掑嫭鍋愰柤鍝ヮ暯閸?-->

        {#if currentModInfo.manifest.states.length > 0}
          <details>
            <summary
              >{_("resource.otherStates")} ({currentModInfo.manifest.states
                .length})</summary
            >
            <div class="tab-content">
              {#if getOtherStatesByPersistence().persistent.length > 0}
                <details class="state-category" open>
                  <summary class="category-summary persistent-cat">
                    {_("resource.persistentStates")} ({getOtherStatesByPersistence()
                      .persistent.length})
                  </summary>
                  <div class="state-list">
                    {#each getOtherStatesByPersistence().persistent as state}
                      <div class="state-card persistent">
                        <div class="state-header">
                          <span class="state-name">{state.name}</span>
                          <span class="badge persistent"
                            >{_("resource.persistent")}</span>
                          {#if state.priority > 0}
                            <span class="badge priority"
                              >{_("resource.priority")} {state.priority}</span>
                          {/if}
                        </div>
                        <div class="state-detail">
                          {#if state.anima}<div class="detail-item">
                              <span class="detail-label"
                                >{_("resource.animationLabel")}</span>
                              {state.anima}
                            </div>{/if}
                          {#if state.audio}<div class="detail-item">
                              <span class="detail-label"
                                >{_("resource.audioLabel")}</span>
                              {state.audio}
                            </div>{/if}
                          {#if state.text}<div class="detail-item">
                              <span class="detail-label"
                                >{_("resource.textLabel")}</span>
                              {state.text}
                            </div>{/if}
                          {#if state.next_state}<div class="detail-item">
                              <span class="detail-label"
                                >{_("resource.nextLabel")}</span>
                              {state.next_state}
                            </div>{/if}
                          {#if state.date_start || state.date_end}
                            <div class="detail-item">
                              <span class="detail-label"
                                >{_("resource.dateLabel")}</span>
                              {state.date_start || "*"} ~ {state.date_end ||
                                "*"}
                            </div>
                          {/if}
                          {#if state.time_start || state.time_end}
                            <div class="detail-item">
                              <span class="detail-label"
                                >{_("resource.timeLabel")}</span>
                              {state.time_start || "*"} ~ {state.time_end ||
                                "*"}
                            </div>
                          {/if}
                          {#if (state.trigger_time ?? 0) > 0}
                            <div class="detail-item">
                              <span class="detail-label"
                                >{_("resource.timerLabel")}</span>
                              {_("resource.timerDesc", {
                                interval: state.trigger_time ?? 0,
                                chance: ((state.trigger_rate ?? 0) * 100).toFixed(0),
                              })}
                            </div>
                          {/if}

                          {#if state.mod_data_counter}
                            <div class="detail-item">
                              <span class="detail-label">{_("resource.modDataCounter")}</span>
                              <span class="tag counter-tag">{state.mod_data_counter.op} {state.mod_data_counter.value}</span>
                            </div>
                          {/if}
                          <div class="detail-item">
                            <span class="detail-label">{_("resource.triggerCounterRange")}</span>
                            <span class="tag counter-tag">{formatTriggerCounterRange(state.trigger_counter_start, state.trigger_counter_end)}</span>
                          </div>
                          {#if state.trigger_temp_start != null || state.trigger_temp_end != null}
                            <div class="detail-item">
                              <span class="detail-label">{_("resource.triggerTempRange")}</span>
                              <span class="tag counter-tag">{formatTempRange(state.trigger_temp_start, state.trigger_temp_end)}</span>
                            </div>
                          {/if}
                          {#if state.trigger_uptime}
                            <div class="detail-item">
                              <span class="detail-label">{_("resource.triggerUptime")}</span>
                              {state.trigger_uptime} {_("resource.minutes")}
                            </div>
                          {/if}
                          {#if state.trigger_weather && state.trigger_weather.length > 0}
                            <div class="detail-item">
                              <span class="detail-label">{_("resource.triggerWeather")}</span>
                              <div class="tag-list">
                                {#each state.trigger_weather as w}
                                  <span class="tag state-tag">{w}</span>
                                {/each}
                              </div>
                            </div>
                          {/if}
                          {#if state.live2d_params && state.live2d_params.length > 0}
                            <div class="detail-item">
                              <span class="detail-label">{_("resource.live2dParamsOverride")}</span>
                              <div class="tag-list">
                                {#each state.live2d_params as p}
                                  <span class="tag state-tag">{p.id}: {p.value}{p.target === "PartOpacity" ? " (Part)" : ""}</span>
                                {/each}
                              </div>
                            </div>
                          {/if}
                          {#if state.pngremix_params && state.pngremix_params.length > 0}
                            <div class="detail-item">
                              <span class="detail-label">{_("resource.pngremixParamsOverride")}</span>
                              <div class="tag-list">
                                {#each state.pngremix_params as p}
                                  <span class="tag state-tag">{p.type}: {p.name}</span>
                                {/each}
                              </div>
                            </div>
                          {/if}
                          {#if state.branch_show_bubble === false}
                            <div class="detail-item">
                              <span class="detail-label">{_("resource.branchShowBubble")}</span>
                              {_("common.no")}
                            </div>
                          {/if}

                          {#if state.can_trigger_states && state.can_trigger_states.length > 0}

                            <div class="detail-item">
                              <span class="detail-label"
                                >{_("resource.triggerable")}</span>
                              <div class="tag-list">
                                {#each state.can_trigger_states as s}
                                  <span class="tag state-tag">{s.state}{(s.weight ?? 1) !== 1 ? `(${s.weight})` : ""}</span>
                                {/each}
                              </div>
                            </div>
                          {/if}

                          {#if state.branch && state.branch.length > 0}
                            <div class="detail-item">
                              <span class="detail-label"
                                >{_("resource.branchLabel")}</span>
                              <div class="branch-list">
                                {#each state.branch as b}
                                  <div class="branch-item">
                                    <span class="branch-text">{b.text}</span>
                                    <span class="branch-arrow">→</span>
                                    <span class="branch-next"
                                      >{b.next_state}</span>
                                  </div>
                                {/each}
                              </div>
                            </div>
                          {/if}
                        </div>
                      </div>
                    {/each}
                  </div>
                </details>
              {/if}
              {#if getOtherStatesByPersistence().nonPersistent.length > 0}
                <details class="state-category" open>
                  <summary class="category-summary non-persistent-cat">
                    {_("resource.nonPersistentStates")} ({getOtherStatesByPersistence()
                      .nonPersistent.length})
                  </summary>
                  <div class="state-list">
                    {#each getOtherStatesByPersistence().nonPersistent as state}
                      <div class="state-card">
                        <div class="state-header">
                          <span class="state-name">{state.name}</span>
                          {#if state.priority > 0}
                            <span class="badge priority"
                              >{_("resource.priority")} {state.priority}</span>
                          {/if}
                        </div>
                        <div class="state-detail">
                          {#if state.anima}<div class="detail-item">
                              <span class="detail-label"
                                >{_("resource.animationLabel")}</span>
                              {state.anima}
                            </div>{/if}
                          {#if state.audio}<div class="detail-item">
                              <span class="detail-label"
                                >{_("resource.audioLabel")}</span>
                              {state.audio}
                            </div>{/if}
                          {#if state.text}<div class="detail-item">
                              <span class="detail-label"
                                >{_("resource.textLabel")}</span>
                              {state.text}
                            </div>{/if}
                          {#if state.next_state}<div class="detail-item">
                              <span class="detail-label"
                                >{_("resource.nextLabel")}</span>
                              {state.next_state}
                            </div>{/if}
                          {#if state.date_start || state.date_end}
                            <div class="detail-item">
                              <span class="detail-label"
                                >{_("resource.dateLabel")}</span>
                              {state.date_start || "*"} ~ {state.date_end ||
                                "*"}
                            </div>
                          {/if}
                          {#if state.time_start || state.time_end}
                            <div class="detail-item">
                              <span class="detail-label"
                                >{_("resource.timeLabel")}</span>
                              {state.time_start || "*"} ~ {state.time_end ||
                                "*"}
                            </div>
                          {/if}
                          {#if (state.trigger_time ?? 0) > 0}
                            <div class="detail-item">
                              <span class="detail-label"
                                >{_("resource.timerLabel")}</span>
                              {_("resource.timerDesc", {
                                interval: state.trigger_time ?? 0,
                                chance: ((state.trigger_rate ?? 0) * 100).toFixed(0),
                              })}
                            </div>
                          {/if}

                          {#if state.mod_data_counter}
                            <div class="detail-item">
                              <span class="detail-label">{_("resource.modDataCounter")}</span>
                              <span class="tag counter-tag">{state.mod_data_counter.op} {state.mod_data_counter.value}</span>
                            </div>
                          {/if}
                          <div class="detail-item">
                            <span class="detail-label">{_("resource.triggerCounterRange")}</span>
                            <span class="tag counter-tag">{formatTriggerCounterRange(state.trigger_counter_start, state.trigger_counter_end)}</span>
                          </div>
                          {#if state.trigger_temp_start != null || state.trigger_temp_end != null}
                            <div class="detail-item">
                              <span class="detail-label">{_("resource.triggerTempRange")}</span>
                              <span class="tag counter-tag">{formatTempRange(state.trigger_temp_start, state.trigger_temp_end)}</span>
                            </div>
                          {/if}
                          {#if state.trigger_uptime}
                            <div class="detail-item">
                              <span class="detail-label">{_("resource.triggerUptime")}</span>
                              {state.trigger_uptime} {_("resource.minutes")}
                            </div>
                          {/if}
                          {#if state.trigger_weather && state.trigger_weather.length > 0}
                            <div class="detail-item">
                              <span class="detail-label">{_("resource.triggerWeather")}</span>
                              <div class="tag-list">
                                {#each state.trigger_weather as w}
                                  <span class="tag state-tag">{w}</span>
                                {/each}
                              </div>
                            </div>
                          {/if}
                          {#if state.live2d_params && state.live2d_params.length > 0}
                            <div class="detail-item">
                              <span class="detail-label">{_("resource.live2dParamsOverride")}</span>
                              <div class="tag-list">
                                {#each state.live2d_params as p}
                                  <span class="tag state-tag">{p.id}: {p.value}{p.target === "PartOpacity" ? " (Part)" : ""}</span>
                                {/each}
                              </div>
                            </div>
                          {/if}
                          {#if state.pngremix_params && state.pngremix_params.length > 0}
                            <div class="detail-item">
                              <span class="detail-label">{_("resource.pngremixParamsOverride")}</span>
                              <div class="tag-list">
                                {#each state.pngremix_params as p}
                                  <span class="tag state-tag">{p.type}: {p.name}</span>
                                {/each}
                              </div>
                            </div>
                          {/if}
                          {#if state.branch_show_bubble === false}
                            <div class="detail-item">
                              <span class="detail-label">{_("resource.branchShowBubble")}</span>
                              {_("common.no")}
                            </div>
                          {/if}

                          {#if state.can_trigger_states && state.can_trigger_states.length > 0}

                            <div class="detail-item">
                              <span class="detail-label"
                                >{_("resource.triggerable")}</span>
                              <div class="tag-list">
                                {#each state.can_trigger_states as s}
                                  <span class="tag state-tag">{s.state}{(s.weight ?? 1) !== 1 ? `(${s.weight})` : ""}</span>
                                {/each}
                              </div>
                            </div>
                          {/if}
                          {#if state.branch && state.branch.length > 0}
                            <div class="detail-item">
                              <span class="detail-label"
                                >{_("resource.branchLabel")}</span>
                              <div class="branch-list">
                                {#each state.branch as b}
                                  <div class="branch-item">
                                    <span class="branch-text">{b.text}</span>
                                    <span class="branch-arrow">→</span>
                                    <span class="branch-next"
                                      >{b.next_state}</span>
                                  </div>
                                {/each}
                              </div>
                            </div>
                          {/if}
                        </div>
                      </div>
                    {/each}
                  </div>
                </details>
              {/if}
            </div>
          </details>
        {/if}

        <!-- 闁荤喐鐟辩粻鎴ｃ亹閸岀偛闂?-->
        {#if currentModInfo.manifest.triggers.length > 0}
          <details>
            <summary
              >{_("resource.triggers")} ({currentModInfo.manifest.triggers
                .length})</summary
            >
            <div class="tab-content">
              <div class="trigger-list">
                {#each currentModInfo.manifest.triggers as trigger}
                  <div class="trigger-card">
                    <span class="trigger-event">{trigger.event}</span>
                    {#if trigger.can_trigger_states.length > 0}
                      <div class="trigger-groups">
                        {#each trigger.can_trigger_states as group, idx}
                          <div class="trigger-group">
                            <div class="group-header">
                              <span class="group-label"
                                >{_("resource.group", { num: idx + 1 })}</span>
                              {#if group.persistent_state}
                                <span class="persistent-badge"
                                  >{_("resource.persistentLabel")}
                                  {group.persistent_state}</span>
                              {:else}
                                <span class="persistent-badge any"
                                  >{_("resource.anyPersistent")}</span>
                              {/if}
                              {#if group.allow_repeat === false}
                                <span class="tag state-tag">{_("resource.noRepeat")}</span>
                              {/if}
                            </div>

                            {#if group.states.length > 0}
                              <div class="trigger-states">
                                {#each group.states as s}
                                  <span class="tag state-tag">{s.state}{(s.weight ?? 1) !== 1 ? `(${s.weight})` : ""}</span>
                                {/each}
                              </div>
                            {:else}
                              <span class="no-states"
                                >{_("resource.noTriggerableStates")}</span>
                            {/if}
                          </div>
                        {/each}
                      </div>
                    {:else}
                      <span class="no-states">{_("resource.noStateGroup")}</span>
                    {/if}
                  </div>
                {/each}
              </div>
            </div>
          </details>
        {/if}

        {#if isSequenceMod()}
          <!-- 闂傚倸鐗婇悷锕傚焵椤戣法顦︽繛瀛橈耿閹囧炊椤忓棎鍋掑┑?-->
          <details>
            <summary
              >{_("resource.staticImages")} ({currentModInfo.imgs
                .length})</summary
            >

          <div class="tab-content">
            <div class="asset-grid">
              {#each currentModInfo.imgs as img}
                {@const totalFrames = img.frame_num_x * img.frame_num_y}
                {@const isAnimated = img.sequence || totalFrames > 1}
                <div class="asset-card-with-thumb" class:animated={isAnimated}>
                  <div class="thumb-container">
                    <button
                      class="thumbnail-btn"
                      onclick={() =>
                        openImageViewer(
                          getAssetSrc(`asset/${img.img}`),
                          img.name,
                        )}
                      title={_("resource.clickToEnlarge")}
                    >
                      <img
                        src={getAssetSrc(`asset/${img.img}`)}
                        alt={img.name}
                        class="thumbnail"
                      />
                    </button>
                    <button
                      class="thumb-open-btn"
                      onclick={() => openAssetFile(`asset/${img.img}`)}
                      title={_("resource.openFile")}
                    >
                      濡絽鍟幆?
                    </button>
                  </div>
                  <div class="asset-info">
                    <div class="asset-name">{img.name}</div>
                    <div class="asset-file">{img.img}</div>
                    <div class="asset-meta">
                      <span title={_("resource.frameSize")}
                        >{img.frame_size_x}闁煎顢檌mg.frame_size_y}px</span>
                      {#if totalFrames > 1}
                        <span title={_("resource.frameLayout")}
                          >{img.frame_num_x}闁煎顢檌mg.frame_num_y} = {totalFrames}{_(
                            "resource.frames",
                          )}</span>
                      {/if}
                    </div>
                    {#if isAnimated}
                      <div class="asset-meta">
                        <span title={_("resource.frameInterval")}
                          >{img.frame_time}s{_("resource.perFrame")}</span>
                      </div>
                    {/if}
                    <div class="asset-flags">
                      {#if img.sequence}
                        <span class="badge sequence-flag"
                          >{_("resource.sequence")}</span>
                      {/if}
                      {#if img.origin_reverse}
                        <span class="badge reverse"
                          >{_("resource.reversePlay")}</span>
                      {/if}
                      {#if img.need_reverse}
                        <span class="badge pingpong"
                          >{_("resource.pingPongMode")}</span>
                      {/if}
                      {#if img.offset_x !== 0 || img.offset_y !== 0}
                        <span class="badge offset"
                          >{_("resource.offset")}
                          {img.offset_x},{img.offset_y}</span>
                      {/if}
                    </div>
                  </div>
                </div>
              {/each}
            </div>
          </div>
        </details>

        <!-- 闁瑰吋娼欑换鎰板垂椤忓牆绀夐柕濞у嫭姣庨柣鐘欏啫顏紒?-->
        <details>
          <summary
            >{_("resource.sequenceAnimations")} ({currentModInfo.sequences
              .length})</summary
          >
          <div class="tab-content">
            <div class="asset-grid">
              {#each currentModInfo.sequences as seq}
                {@const totalFrames = seq.frame_num_x * seq.frame_num_y}
                {@const totalDuration = (totalFrames * seq.frame_time).toFixed(
                  2,
                )}
                <div class="asset-card-with-thumb sequence">
                  <div class="thumb-container">
                    <button
                      class="thumbnail-btn"
                      onclick={() =>
                        openImageViewer(
                          getAssetSrc(`asset/${seq.img}`),
                          seq.name,
                        )}
                      title={_("resource.clickToEnlarge")}
                    >
                      <img
                        src={getAssetSrc(`asset/${seq.img}`)}
                        alt={seq.name}
                        class="thumbnail sequence-thumb"
                      />
                    </button>
                    <button
                      class="thumb-open-btn"
                      onclick={() => openAssetFile(`asset/${seq.img}`)}
                      title={_("resource.openFile")}
                    >
                      濡絽鍟幆?
                    </button>
                  </div>
                  <div class="asset-info">
                    <div class="asset-name">{seq.name}</div>
                    <div class="asset-file">{seq.img}</div>
                    <div class="asset-meta">
                      <span title={_("resource.frameLayout")}
                        >{seq.frame_num_x}闁煎顢檚eq.frame_num_y} = {totalFrames}{_(
                          "resource.frames",
                        )}</span>
                      <span title={_("resource.frameSize")}
                        >{seq.frame_size_x}闁煎顢檚eq.frame_size_y}px</span>
                    </div>
                    <div class="asset-meta">
                      <span title={_("resource.frameInterval")}
                        >{seq.frame_time}s{_("resource.perFrame")}</span>
                      <span title={_("resource.totalDuration")}
                        >闂佹剚鍠栧鏉talDuration}s</span>
                    </div>
                    <div class="asset-flags">
                      {#if seq.origin_reverse}
                        <span class="badge reverse"
                          >{_("resource.reversePlay")}</span>
                      {/if}
                      {#if seq.need_reverse}
                        <span class="badge pingpong"
                          >{_("resource.pingPongMode")}</span>
                      {/if}
                      {#if seq.offset_x !== 0 || seq.offset_y !== 0}
                        <span class="badge offset"
                          >{_("resource.offset")}
                          {seq.offset_x},{seq.offset_y}</span>
                      {/if}
                    </div>
                  </div>
                </div>
              {/each}
            </div>
          </div>
        </details>
        {/if}

        <!-- Live2D 闁荤姍鍐仾缂?-->
        {#if isLive2dMod()}
          <details>
            <summary>{_("resource.live2dAssets")}</summary>
            <div class="tab-content">
              {#if currentModInfo.live2d}
                <h5>{_("resource.live2dModel")}</h5>
                <div class="info-grid">
                  <div class="info-row">
                    <span class="info-label">{_("resource.live2dModelJson")}</span>
                    <span class="info-value">{currentModInfo.live2d.model.model_json}</span>
                  </div>
                  <div class="info-row">
                    <span class="info-label">{_("resource.live2dBaseDir")}</span>
                    <span class="info-value">{currentModInfo.live2d.model.base_dir}</span>
                  </div>
                  <div class="info-row">
                    <span class="info-label">{_("resource.live2dTextureDir")}</span>
                    <span class="info-value">{currentModInfo.live2d.model.textures_dir}</span>
                  </div>
                  <div class="info-row">
                    <span class="info-label">{_("resource.live2dMotionsDir")}</span>
                    <span class="info-value">{currentModInfo.live2d.model.motions_dir}</span>
                  </div>
                  <div class="info-row">
                    <span class="info-label">{_("resource.live2dExpressionsDir")}</span>
                    <span class="info-value">{currentModInfo.live2d.model.expressions_dir}</span>
                  </div>
                  <div class="info-row">
                    <span class="info-label">{_("resource.live2dPhysics")}</span>
                    <span class="info-value">{currentModInfo.live2d.model.physics_json || _("resource.notSet")}</span>
                  </div>
                  <div class="info-row">
                    <span class="info-label">{_("resource.live2dPose")}</span>
                    <span class="info-value">{currentModInfo.live2d.model.pose_json || _("resource.notSet")}</span>
                  </div>
                  <div class="info-row">
                    <span class="info-label">{_("resource.live2dBreath")}</span>
                    <span class="info-value">{currentModInfo.live2d.model.breath_json || _("resource.notSet")}</span>
                  </div>
                  <div class="info-row">
                    <span class="info-label">{_("resource.live2dModelScale")}</span>
                    <span class="info-value">{currentModInfo.live2d.model.scale ?? 1}</span>
                  </div>
                  <div class="info-row">
                    <span class="info-label">{_("resource.live2dEyeBlink")}</span>
                    <span class="info-value">{currentModInfo.live2d.model.eye_blink ? _("common.yes") : _("common.no")}</span>
                  </div>
                  <div class="info-row">
                    <span class="info-label">{_("resource.live2dLipSync")}</span>
                    <span class="info-value">{currentModInfo.live2d.model.lip_sync ? _("common.yes") : _("common.no")}</span>

                  </div>
                </div>

                <details open class="live2d-section">
                  <summary>
                    {_("resource.live2dMotions")} ({currentModInfo.live2d.motions.length})
                  </summary>
                  <div class="state-list">
                    {#each currentModInfo.live2d.motions as motion}
                      <div class="state-card">
                        <div class="state-header">
                          <span class="state-name">{motion.name}</span>
                        </div>
                        <div class="state-detail">
                          <div class="detail-item">
                            <span class="detail-label">{_("resource.animationLabel")}</span>
                            {motion.file}
                          </div>
                          {#if motion.group}
                            <div class="detail-item">
                              <span class="detail-label">{_("resource.live2dGroup")}</span>
                              {motion.group}
                            </div>
                          {/if}
                          {#if motion.priority}
                            <div class="detail-item">
                              <span class="detail-label">{_("resource.live2dPriority")}</span>
                              {motion.priority}
                            </div>
                          {/if}
                          <div class="detail-item">
                            <span class="detail-label">{_("resource.live2dFade")}</span>
                            {motion.fade_in_ms}ms / {motion.fade_out_ms}ms
                          </div>
                          {#if motion.loop}
                            <div class="detail-item">
                              <span class="detail-label">{_("resource.live2dLoop")}</span>
                              {_("common.yes")}
                            </div>
                          {/if}

                        </div>
                      </div>
                    {/each}
                  </div>
                </details>

                <details open class="live2d-section">
                  <summary>
                    {_("resource.live2dExpressions")} ({currentModInfo.live2d.expressions.length})
                  </summary>
                  <div class="state-list">
                    {#each currentModInfo.live2d.expressions as exp}
                      <div class="state-card">
                        <div class="state-header">
                          <span class="state-name">{exp.name}</span>
                        </div>
                        <div class="state-detail">
                          <div class="detail-item">
                            <span class="detail-label">{_("resource.animationLabel")}</span>
                            {exp.file}
                          </div>
                        </div>
                      </div>
                    {/each}
                  </div>
                </details>

                <details open class="live2d-section">
                  <summary>
                    {_("resource.live2dStates")} ({currentModInfo.live2d.states.length})
                  </summary>
                  <div class="state-list">
                    {#each currentModInfo.live2d.states as lstate}
                      <div class="state-card">
                        <div class="state-header">
                          <span class="state-name">{lstate.state}</span>
                        </div>
                        <div class="state-detail">
                          <div class="detail-item">
                            <span class="detail-label">{_("resource.live2dStateMotion")}</span>
                            {lstate.motion}
                          </div>
                          {#if lstate.expression}
                            <div class="detail-item">
                              <span class="detail-label">{_("resource.live2dStateExpression")}</span>
                              {lstate.expression}
                            </div>
                          {/if}
                          <div class="detail-item">
                            <span class="detail-label">{_("resource.live2dStateScale")}</span>
                            {lstate.scale}
                          </div>
                          <div class="detail-item">
                            <span class="detail-label">{_("resource.live2dStateOffset")}</span>
                            {lstate.offset_x},{lstate.offset_y}
                          </div>
                        </div>
                      </div>
                    {/each}
                  </div>
                </details>

              {:else}
                <div class="info-row">
                  <span class="info-label">{_("resource.live2dAssets")}</span>
                  <span class="info-value">{_("resource.notSet")}</span>
                </div>
              {/if}
            </div>
          </details>
        {/if}

        <!-- PngRemix 闁荤姍鍐仾缂?-->
        {#if isPngremixMod()}
          <details>
            <summary>{_("resource.pngremixAssets")}</summary>
            <div class="tab-content">
              {#if currentModInfo.pngremix}
                <h5>{_("resource.pngremixModel")}</h5>
                <div class="info-grid">
                  <div class="info-row">
                    <span class="info-label">{_("resource.pngremixName")}</span>
                    <span class="info-value">{currentModInfo.pngremix.model.name}</span>
                  </div>
                  <div class="info-row">
                    <span class="info-label">{_("resource.pngremixFile")}</span>
                    <span class="info-value">{currentModInfo.pngremix.model.pngremix_file}</span>
                  </div>
                  <div class="info-row">
                    <span class="info-label">{_("resource.pngremixDefaultStateIndex")}</span>
                    <span class="info-value">{currentModInfo.pngremix.model.default_state_index}</span>
                  </div>
                  <div class="info-row">
                    <span class="info-label">{_("resource.pngremixScale")}</span>
                    <span class="info-value">{currentModInfo.pngremix.model.scale ?? 1}</span>
                  </div>
                  <div class="info-row">
                    <span class="info-label">{_("resource.pngremixMaxFps")}</span>
                    <span class="info-value">{currentModInfo.pngremix.model.max_fps}</span>
                  </div>
                </div>

                <h5>{_("resource.pngremixFeatures")}</h5>
                <div class="info-grid">
                  <div class="info-row">
                    <span class="info-label">{_("resource.pngremixMouseFollow")}</span>
                    <span class="info-value">{currentModInfo.pngremix.features.mouse_follow ? _("common.yes") : _("common.no")}</span>
                  </div>
                  <div class="info-row">
                    <span class="info-label">{_("resource.pngremixAutoBlink")}</span>
                    <span class="info-value">{currentModInfo.pngremix.features.auto_blink ? _("common.yes") : _("common.no")}</span>
                  </div>
                  <div class="info-row">
                    <span class="info-label">{_("resource.pngremixClickBounce")}</span>
                    <span class="info-value">{currentModInfo.pngremix.features.click_bounce ? _("common.yes") : _("common.no")}</span>
                  </div>
                  {#if currentModInfo.pngremix.features.click_bounce}
                    <div class="info-row">
                      <span class="info-label">{_("resource.pngremixBounceAmpDuration")}</span>
                      <span class="info-value">{currentModInfo.pngremix.features.click_bounce_amp} / {currentModInfo.pngremix.features.click_bounce_duration}s</span>
                    </div>
                  {/if}
                  {#if currentModInfo.pngremix.features.auto_blink}
                    <div class="info-row">
                      <span class="info-label">{_("resource.pngremixBlinkParams")}</span>
                      <span class="info-value">{currentModInfo.pngremix.features.blink_speed} / {currentModInfo.pngremix.features.blink_chance} / {currentModInfo.pngremix.features.blink_hold_ratio}</span>
                    </div>
                  {/if}
                </div>

                <details open class="live2d-section">
                  <summary>
                    {_("resource.pngremixExpressions")} ({currentModInfo.pngremix.expressions.length})
                  </summary>
                  <div class="state-list">
                    {#each currentModInfo.pngremix.expressions as expr}
                      <div class="state-card">
                        <div class="state-header">
                          <span class="state-name">{expr.name}</span>
                        </div>
                        <div class="state-detail">
                          <div class="detail-item">
                            <span class="detail-label">{_("resource.pngremixStateIndex")}</span>
                            {expr.state_index}
                          </div>
                        </div>
                      </div>
                    {/each}
                  </div>
                </details>

                <details open class="live2d-section">
                  <summary>
                    {_("resource.pngremixMotions")} ({currentModInfo.pngremix.motions.length})
                  </summary>
                  <div class="state-list">
                    {#each currentModInfo.pngremix.motions as motion}
                      <div class="state-card">
                        <div class="state-header">
                          <span class="state-name">{motion.name}</span>
                        </div>
                        <div class="state-detail">
                          <div class="detail-item">
                            <span class="detail-label">{_("resource.pngremixHotkey")}</span>
                            {motion.hotkey}
                          </div>
                          {#if motion.description}
                            <div class="detail-item">
                              <span class="detail-label">{_("resource.pngremixDescription")}</span>
                              {motion.description}
                            </div>
                          {/if}
                        </div>
                      </div>
                    {/each}
                  </div>
                </details>

                <details open class="live2d-section">
                  <summary>
                    {_("resource.pngremixStates")} ({currentModInfo.pngremix.states.length})
                  </summary>
                  <div class="state-list">
                    {#each currentModInfo.pngremix.states as pstate}
                      <div class="state-card">
                        <div class="state-header">
                          <span class="state-name">{pstate.state}</span>
                        </div>
                        <div class="state-detail">
                          {#if pstate.expression}
                            <div class="detail-item">
                              <span class="detail-label">{_("resource.live2dStateExpression")}</span>
                              {pstate.expression}
                            </div>
                          {/if}
                          {#if pstate.motion}
                            <div class="detail-item">
                              <span class="detail-label">{_("resource.live2dStateMotion")}</span>
                              {pstate.motion}
                            </div>
                          {/if}
                          <div class="detail-item">
                            <span class="detail-label">{_("resource.pngremixMouthState")}</span>
                            {formatMouthState(pstate.mouth_state)}
                          </div>
                          <div class="detail-item">
                            <span class="detail-label">{_("resource.live2dStateScale")}</span>
                            {pstate.scale}
                          </div>
                          <div class="detail-item">
                            <span class="detail-label">{_("resource.live2dStateOffset")}</span>
                            {pstate.offset_x},{pstate.offset_y}
                          </div>
                        </div>
                      </div>
                    {/each}
                  </div>
                </details>

              {:else}
                <div class="info-row">
                  <span class="info-label">{_("resource.pngremixAssets")}</span>
                  <span class="info-value">{_("resource.notSet")}</span>
                </div>
              {/if}
            </div>
          </details>
        {/if}

        <!-- 3D 闁荤姍鍐仾缂?-->
        {#if isThreeDMod()}
          <details>
            <summary>{_("resource.threeDAssets")}</summary>
            <div class="tab-content">
              {#if currentModInfo.threed}
                <h5>{_("resource.threeDModel")}</h5>
                <div class="info-grid">
                  <div class="info-row">
                    <span class="info-label">{_("resource.pngremixName")}</span>
                    <span class="info-value">{currentModInfo.threed.model.name}</span>
                  </div>
                  <div class="info-row">
                    <span class="info-label">{_("resource.threeDModelType")}</span>
                    <span class="info-value">{currentModInfo.threed.model.type}</span>
                  </div>
                  <div class="info-row">
                    <span class="info-label">{_("resource.pngremixFile")}</span>
                    <span class="info-value">{currentModInfo.threed.model.file}</span>
                  </div>
                  <div class="info-row">
                    <span class="info-label">{_("resource.pngremixScale")}</span>
                    <span class="info-value">{currentModInfo.threed.model.scale}</span>
                  </div>
                  <div class="info-row">
                    <span class="info-label">{_("resource.live2dStateOffset")}</span>
                    <span class="info-value">{currentModInfo.threed.model.offset_x}, {currentModInfo.threed.model.offset_y}</span>
                  </div>
                  {#if currentModInfo.threed.model.texture_base_dir}
                    <div class="info-row">
                      <span class="info-label">{_("resource.threeDTextureBaseDir")}</span>
                      <span class="info-value">{currentModInfo.threed.model.texture_base_dir}</span>
                    </div>
                  {/if}
                  {#if currentModInfo.threed.model.animation_base_dir}
                    <div class="info-row">
                      <span class="info-label">{_("resource.threeDAnimationBaseDir")}</span>
                      <span class="info-value">{currentModInfo.threed.model.animation_base_dir}</span>
                    </div>
                  {/if}
                </div>

                <details open class="live2d-section">
                  <summary>
                    {_("resource.threeDAnimations")} ({currentModInfo.threed.animations.length})
                  </summary>
                  <div class="state-list">
                    {#each currentModInfo.threed.animations as anim}
                      <div class="state-card">
                        <div class="state-header">
                          <span class="state-name">{anim.name}</span>
                          <span class="motion-group">{anim.type}</span>
                        </div>
                        <div class="state-detail">
                          <div class="detail-item">
                            <span class="detail-label">{_("resource.pngremixFile")}</span>
                            {anim.file}
                          </div>
                          <div class="detail-item">
                            <span class="detail-label">{_("resource.threeDSpeed")}</span>
                            {anim.speed}
                          </div>
                            <div class="detail-item">
                              <span class="detail-label">{_("resource.threeDFps")}</span>
                              {anim.fps}
                            </div>
                        </div>
                      </div>
                    {/each}
                  </div>
                </details>



              {:else}
                <div class="info-row">
                  <span class="info-label">{_("resource.threeDAssets")}</span>
                  <span class="info-value">{_("resource.notSet")}</span>
                </div>
              {/if}
            </div>
          </details>
        {/if}

        <!-- 闁荤姴娴傞崣鍐偂閸撲焦灏庨柛鏇ㄥ墰閻?-->

        <details>
          <summary>{_("resource.audioResources")} ({getTotalAudios()})</summary>
          <div class="tab-content">
            {#each Object.entries(currentModInfo.audios) as [lang, audios]}
              <details class="lang-details" open>
                <summary class="lang-summary">{lang} ({audios.length})</summary>
                <div class="audio-grid">
                  {#each audios as audio}
                    <div
                      class="audio-card"
                      class:playing={playingAudioName ===
                        `${lang}/${audio.name}`}
                    >
                      <button
                        class="play-btn"
                        onclick={() =>
                          playAudio(audio.audio, `${lang}/${audio.name}`)}
                        title={playingAudioName === `${lang}/${audio.name}`
                          ? _("common.stop")
                          : _("common.play")}
                      >
                        {#if playingAudioName === `${lang}/${audio.name}`}
                          <span class="icon">?</span>
                        {:else}
                          <span class="icon">?</span>
                        {/if}


                      </button>
                      <div class="audio-info">
                        <div class="audio-name">{audio.name}</div>
                        <div class="audio-file">{audio.audio}</div>
                      </div>
                      <button
                        class="open-btn"
                        onclick={() => openAssetFile(`audio/${audio.audio}`)}
                        title={_("resource.openFile")}
                      >
                        濡絽鍟幆?
                      </button>
                    </div>
                  {/each}
                </div>
              </details>
            {/each}
          </div>
        </details>

        <!-- 闁诲海鏁搁、濠囨儊娴犲妫橀柛銉ｅ妽閹?-->
        <details>
          <summary>{_("resource.dialogTexts")} ({getTotalTexts()})</summary>
          <div class="tab-content">
            {#each Object.entries(currentModInfo.texts) as [lang, texts]}
              <details class="lang-details" open>
                <summary class="lang-summary">{lang} ({texts.length})</summary>
                <div class="text-list">
                  {#each texts as text}
                    <div class="text-card">
                      <div class="text-header">
                        <span class="text-name">{text.name}</span>
                        <span class="text-duration">{text.duration}s</span>
                      </div>
                      <div class="text-body">{text.text}</div>
                    </div>
                  {/each}
                </div>
              </details>
            {/each}
          </div>
        </details>
      </div>
    </div>
  {/if}
</div>

<!-- 闂佹悶鍎辨晶鑺ユ櫠閺嶎厼钃熼柕澹嫮鐣介梺闈╃祷閸斿矂鎳樻繝鍕幓?-->
{#if viewerVisible}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="image-viewer-overlay" onclick={closeImageViewer}>
    <div class="image-viewer-content" onclick={(e) => e.stopPropagation()}>
      <div class="viewer-header">
        <span class="viewer-title">{viewerImageTitle}</span>
        <button class="viewer-close" onclick={closeImageViewer}>×</button>


      </div>
      <div class="viewer-body">
        <img src={viewerImageSrc} alt={viewerImageTitle} class="viewer-image" />
      </div>
    </div>
  </div>
{/if}

<style>
  .debug-panel {
    background: #ffffff;
    border-radius: 12px;
    padding: 20px;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1);
    width: 700px;
    margin: 20px auto;
    color: #333;
    font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
  }

  h3 {
    margin-top: 0;
    color: #2c3e50;
    border-bottom: 2px solid #eee;
    padding-bottom: 10px;
    margin-bottom: 5px;
  }

  h5 {
    margin: 12px 0 6px 0;
    color: #2c3e50;
  }

  .path-info {
    font-size: 0.75em;
    color: #666;
    background: #f0f0f0;
    padding: 8px;
    border-radius: 4px;
    margin-bottom: 15px;
  }

  .path-item {
    word-break: break-all;
    margin-top: 4px;
    padding: 2px 4px;
    background: rgba(0, 0, 0, 0.05);
    border-radius: 2px;
  }

  .info-panel {
    margin-top: 20px;
    padding: 15px;
    background: #f8f9fa;
    border-radius: 8px;
    font-size: 0.85em;
    max-height: 650px;
    overflow-y: auto;
  }

  .info-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid #ddd;
    margin-bottom: 10px;
    padding-bottom: 5px;
  }

  .info-header h4 {
    margin: 0;
  }

  .path-badge {
    font-size: 0.7em;
    background: #e0e0e0;
    padding: 2px 8px;
    border-radius: 10px;
    max-width: 150px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* 缂傚倷鑳堕崰鏇㈩敇缁嬫娼￠柛灞剧箥濞?*/
  .stats-bar {
    display: flex;
    gap: 8px;
    margin-bottom: 15px;
    flex-wrap: wrap;
  }

  .stat-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    background: white;
    padding: 8px 16px;
    border-radius: 8px;
    border: 1px solid #eee;
    min-width: 60px;
  }

  .stat-value {
    font-size: 1.4em;
    font-weight: bold;
    color: #3498db;
  }

  .stat-label {
    font-size: 0.75em;
    color: #7f8c8d;
  }

  /* 闁荤姴娴勯梽鍕磿韫囨稑绠俊顖氭惈缂?*/
  details {
    margin-bottom: 8px;
    border: 1px solid #eee;
    border-radius: 6px;
    background: white;
  }

  summary {
    padding: 10px 12px;
    cursor: pointer;
    font-weight: bold;
    background: #f5f6f7;
    border-radius: 6px;
    user-select: none;
  }

  details[open] summary {
    border-bottom: 1px solid #eee;
    border-radius: 6px 6px 0 0;
  }

  .tab-content {
    padding: 12px;
  }

  /* 婵烇絽娲犻崜婵囧閸涱垳纾鹃柟瀵稿仧婢?*/
  .info-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 8px;
  }

  .info-grid.compact {
    grid-template-columns: repeat(3, 1fr);
  }

  .info-row {
    display: flex;
    flex-direction: column;
    background: #f9f9f9;
    padding: 6px 10px;
    border-radius: 4px;
  }

  .info-label {
    font-size: 0.75em;
    color: #7f8c8d;
    margin-bottom: 2px;
  }

  .info-value {
    font-weight: 500;
  }

  /* 闁荤姴娴傞崣鈧柍璇茬墦瀹曪繝鏁嶉崟顐毈 */
  .lang-cards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 10px;
  }

  .lang-card {
    display: flex;
    align-items: center;
    gap: 10px;
    background: #f9f9f9;
    padding: 10px;
    border-radius: 6px;
    border: 1px solid #eee;
  }

  .lang-code {
    background: #34495e;
    color: white;
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 0.8em;
    font-weight: bold;
  }

  .lang-info {
    flex: 1;
  }

  .char-name {
    font-weight: bold;
    color: #2c3e50;
  }

  .char-meta {
    font-size: 0.8em;
    color: #7f8c8d;
    display: flex;
    gap: 10px;
  }

  .char-desc {
    font-size: 0.8em;
    color: #555;
    margin-top: 4px;
    font-style: italic;
  }

  /* 闂佺粯枪閸╂牠鍩€椤戣法顦﹂柛顭戜簽閹?*/
  .state-list,
  .trigger-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .state-card {
    background: #f9f9f9;
    border: 1px solid #eee;
    border-left: 4px solid #95a5a6;
    padding: 10px;
    border-radius: 6px;
  }

  .state-card.persistent {
    border-left-color: #27ae60;
  }

  .state-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 6px;
  }

  .state-name {
    font-weight: bold;
    color: #2c3e50;
  }

  .badge {
    display: inline-block;
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 0.7em;
    font-weight: bold;
  }

  .badge.persistent {
    background: #27ae60;
    color: white;
  }
  .badge.priority {
    background: #f39c12;
    color: white;
  }
  .badge.reverse {
    background: #e74c3c;
    color: white;
  }
  .badge.pingpong {
    background: #9b59b6;
    color: white;
  }
  .badge.offset {
    background: #3498db;
    color: white;
  }
  .badge.sequence-flag {
    background: #f1c40f;
    color: #2c3e50;
  }

  .state-detail {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 0.9em;
  }

  .detail-item {
    display: flex;
    align-items: flex-start;
    gap: 6px;
  }

  .detail-label {
    color: #7f8c8d;
    min-width: 50px;
  }

  .tag-list {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .tag {
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 0.8em;
    background: #ecf0f1;
    border: 1px solid #bdc3c7;
  }

  .tag.state-tag {
    background: #e8f6f3;
    border-color: #1abc9c;
    color: #16a085;
  }

  .tag.counter-tag {
    background: #fdf2e9;
    border-color: #e67e22;
    color: #d35400;
  }


  /* 闂佺粯枪閸╂牠鍩€椤戣法顦﹂柛銊ユ捣閻氬墽绱掑Ο渚綑闂?*/
  .state-category {
    margin-bottom: 10px;
    border: none;
    background: transparent;
  }

  .category-summary {
    padding: 8px 12px;
    font-weight: bold;
    border-radius: 6px;
    font-size: 0.9em;
  }

  .category-summary.persistent-cat {
    background: #d5f5e3;
    border-left: 4px solid #27ae60;
  }

  .category-summary.non-persistent-cat {
    background: #eaecee;
    border-left: 4px solid #95a5a6;
  }

  .state-category[open] .category-summary {
    border-radius: 6px 6px 0 0;
    margin-bottom: 8px;
  }

  /* 闁荤姴娴傞崣鈧柍璇茬墦楠炲骸螣閸濆嫮绉?*/
  .lang-details {
    margin-bottom: 10px;
    border: none;
    background: transparent;
    border-left: 3px solid #3498db;
    padding-left: 8px;
  }

  .lang-summary {
    padding: 6px 10px;
    font-weight: bold;
    font-size: 0.9em;
    background: #ebf5fb;
    border-radius: 4px;
    cursor: pointer;
  }

  .lang-details[open] .lang-summary {
    margin-bottom: 8px;
  }

  /* 闂佸憡甯掑Λ娆撳极椤曗偓瀹曟艾螖閸曗斁鍋?*/
  .branch-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .branch-item {
    display: flex;
    align-items: center;
    gap: 6px;
    background: #fef5e7;
    border: 1px solid #f39c12;
    border-radius: 4px;
    padding: 4px 8px;
    font-size: 0.9em;
  }

  .branch-text {
    color: #d68910;
    font-weight: 500;
  }

  .branch-arrow {
    color: #95a5a6;
  }

  .branch-next {
    color: #16a085;
    font-weight: 600;
  }

  /* 闁荤喐鐟辩粻鎴ｃ亹閸岀偛闂?*/
  .trigger-card {
    background: #f9f9f9;
    border: 1px solid #eee;
    border-left: 4px solid #9b59b6;
    padding: 10px;
    border-radius: 6px;
  }

  .trigger-event {
    font-weight: bold;
    color: #8e44ad;
    display: block;
    margin-bottom: 6px;
  }

  .trigger-states {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .trigger-groups {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 8px;
  }

  .trigger-group {
    background: rgba(0, 0, 0, 0.03);
    border-radius: 6px;
    padding: 8px;
    border: 1px solid #e0e0e0;
  }

  .group-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 6px;
  }

  .group-label {
    font-size: 0.75em;
    font-weight: bold;
    color: #7f8c8d;
  }

  .persistent-badge {
    font-size: 0.75em;
    background: #27ae60;
    color: white;
    padding: 2px 6px;
    border-radius: 4px;
  }

  .persistent-badge.any {
    background: #95a5a6;
  }

  .no-states {
    font-size: 0.85em;
    color: #95a5a6;
    font-style: italic;
  }

  /* 闁荤姍鍐仾缂侇煈鍠氱槐鏃堝箣閻愰潧顥?*/
  .asset-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 12px;
  }

  .asset-card-with-thumb {
    background: #f9f9f9;
    border: 1px solid #eee;
    border-radius: 8px;
    overflow: hidden;
  }

  .asset-card-with-thumb.sequence {
    border-left: 4px solid #f1c40f;
  }

  .asset-card-with-thumb.animated {
    border-left: 4px solid #e67e22;
  }

  .thumb-container {
    position: relative;
  }

  .thumbnail-btn {
    width: 100%;
    padding: 0;
    background: #e8e8e8;
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100px;
    overflow: hidden;
  }

  .thumbnail-btn:hover {
    background: #ddd;
  }

  .thumb-open-btn {
    position: absolute;
    top: 4px;
    right: 4px;
    width: 24px;
    height: 24px;
    padding: 0;
    background: rgba(255, 255, 255, 0.9);
    border: 1px solid #ddd;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0.7;
    transition: opacity 0.2s;
  }

  .thumb-open-btn:hover {
    opacity: 1;
    background: white;
  }

  .thumbnail {
    max-width: 100%;
    max-height: 100px;
    object-fit: contain;
  }

  .sequence-thumb {
    max-width: 150%;
    object-fit: cover;
    object-position: left top;
  }

  .asset-info {
    padding: 8px;
  }

  .asset-name {
    font-weight: bold;
    color: #2980b9;
    word-break: break-all;
    margin-bottom: 2px;
  }

  .asset-file {
    color: #7f8c8d;
    font-size: 0.8em;
    word-break: break-all;
  }

  .asset-meta {
    margin-top: 4px;
    color: #95a5a6;
    font-size: 0.75em;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .asset-flags {
    margin-top: 4px;
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  /* 闂傚倸锕ユ繛濠囥€傞崜浣虹＞闁瑰鍋熸竟?*/
  .audio-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 8px;
  }

  .audio-card {
    display: flex;
    align-items: center;
    gap: 8px;
    background: #f9f9f9;
    border: 1px solid #eee;
    border-radius: 6px;
    padding: 8px;
    transition: all 0.2s;
  }

  .audio-card.playing {
    background: #e8f6f3;
    border-color: #1abc9c;
  }

  .play-btn {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: #3498db;
    color: white;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    padding: 0;
  }

  .play-btn:hover {
    background: #2980b9;
  }

  .audio-card.playing .play-btn {
    background: #e74c3c;
  }

  .audio-card.playing .play-btn:hover {
    background: #c0392b;
  }

  .icon {
    font-size: 14px;
  }

  .audio-info {
    flex: 1;
    min-width: 0;
  }

  .audio-name {
    font-weight: bold;
    color: #2c3e50;
    word-break: break-all;
  }

  .audio-file {
    font-size: 0.75em;
    color: #7f8c8d;
    word-break: break-all;
  }

  .open-btn {
    width: 28px;
    height: 28px;
    padding: 0;
    background: transparent;
    border: 1px solid #ddd;
    border-radius: 4px;
    flex-shrink: 0;
  }

  .open-btn:hover {
    background: #eee;
  }

  /* 闂佸搫鍊稿ú锕€锕㈡导鏉戠婵°倕瀚ㄩ埀?*/
  .text-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .text-card {
    background: #f9f9f9;
    border: 1px solid #eee;
    border-radius: 6px;
    padding: 10px;
  }

  .text-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 6px;
  }

  .text-name {
    font-weight: bold;
    color: #2c3e50;
  }

  .text-duration {
    font-size: 0.75em;
    color: #7f8c8d;
    background: #eee;
    padding: 2px 6px;
    border-radius: 3px;
  }

  .text-body {
    color: #555;
    line-height: 1.5;
    white-space: pre-wrap;
  }

  /* 闂佹悶鍎辨晶鑺ユ櫠閺嶎厼钃熼柕澹嫮鐣介梺?*/
  .image-viewer-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.85);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
  }

  .image-viewer-content {
    background: white;
    border-radius: 12px;
    max-width: 90vw;
    max-height: 90vh;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .viewer-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 16px;
    border-bottom: 1px solid #eee;
    background: #f8f9fa;
  }

  .viewer-title {
    font-weight: bold;
    color: #2c3e50;
  }

  .viewer-close {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: #e74c3c;
    color: white;
    font-size: 16px;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .viewer-close:hover {
    background: #c0392b;
  }

  .viewer-body {
    padding: 20px;
    overflow: auto;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #f0f0f0;
  }

  .viewer-image {
    max-width: 100%;
    max-height: 75vh;
    object-fit: contain;
  }

  /* 闂佸搫妫欓〃澶嬬珶婵犲啰鈻斿┑鐘冲嚬閺?*/
  @media (prefers-color-scheme: dark) {
    .debug-panel {
      background: #2c3e50;
      color: #ecf0f1;
    }
    h3,
    h4,
    h5 {
      color: #ecf0f1;
    }
    h3 {
      border-bottom-color: #34495e;
    }

    .info-panel {
      background: #34495e;
    }
    .path-info {
      background: #34495e;
      color: #bdc3c7;
    }

    details {
      background: #2c3e50;
      border-color: #455a64;
    }
    summary {
      background: #3e5871;
      color: #ecf0f1;
    }

    .stat-item {
      background: #3e5871;
      border-color: #455a64;
    }
    .info-row {
      background: #3e5871;
    }
    .lang-card {
      background: #3e5871;
      border-color: #455a64;
    }
    .char-name {
      color: #ecf0f1;
    }
    .char-desc {
      color: #95a5a6;
    }

    .state-card,
    .trigger-card {
      background: #3e5871;
      border-color: #455a64;
    }
    .state-name {
      color: #ecf0f1;
    }
    .trigger-event {
      color: #bb8fce;
    }

    .asset-card-with-thumb {
      background: #3e5871;
      border-color: #455a64;
    }
    .thumbnail-btn {
      background: #2c3e50;
    }
    .thumbnail-btn:hover {
      background: #34495e;
    }
    .asset-name {
      color: #5dade2;
    }

    .audio-card {
      background: #3e5871;
      border-color: #455a64;
    }
    .audio-card.playing {
      background: #1e4d3d;
      border-color: #1abc9c;
    }
    .audio-name {
      color: #ecf0f1;
    }

    .text-card {
      background: #3e5871;
      border-color: #455a64;
    }
    .text-name {
      color: #ecf0f1;
    }
    .text-body {
      color: #bdc3c7;
    }
    .text-duration {
      background: #2c3e50;
    }

    .path-badge {
      background: #455a64;
      color: #bdc3c7;
    }
    .tag {
      background: #455a64;
      border-color: #546e7a;
      color: #ecf0f1;
    }

    .trigger-group {
      background: rgba(255, 255, 255, 0.05);
      border-color: #455a64;
    }
    .branch-item {
      background: #4a3d1e;
      border-color: #d68910;
    }
    .branch-text {
      color: #f1c40f;
    }
    .branch-next {
      color: #2ecc71;
    }

    .category-summary.persistent-cat {
      background: #1e4d3d;
    }
    .category-summary.non-persistent-cat {
      background: #3e5871;
    }
    .lang-summary {
      background: #2e4a62;
    }
    .lang-details {
      border-left-color: #5dade2;
    }

    .thumb-open-btn {
      background: rgba(60, 60, 60, 0.9);
      border-color: #555;
      color: white;
    }
    .thumb-open-btn:hover {
      background: #444;
    }

    .image-viewer-content {
      background: #2c3e50;
    }
    .viewer-header {
      background: #34495e;
      border-bottom-color: #455a64;
    }
    .viewer-title {
      color: #ecf0f1;
    }
    .viewer-body {
      background: #1a252f;
    }
  }
</style>




