; NSIS installer hooks for TrayBuddy (Tauri v2)
; Ensure .tbuddy and .sbuddy use dedicated icons.

!macro NSIS_HOOK_POSTINSTALL
  ; Tauri itself may register file associations; we only override the DefaultIcon.

  ; ---- .tbuddy ----
  ReadRegStr $0 SHCTX "Software\Classes\.tbuddy" ""
  StrCmp $0 "" 0 +2
    StrCpy $0 "TrayBuddy.ModPackage"

  ; Keep a stable ProgID fallback if none exists
  WriteRegStr SHCTX "Software\Classes\.tbuddy" "" $0
  WriteRegStr SHCTX "Software\Classes\$0" "" "TrayBuddy Mod Package"
  WriteRegStr SHCTX "Software\Classes\$0\DefaultIcon" "" "$INSTDIR\icons\tbuddy.ico,0"

  ; ---- .sbuddy ----
  ReadRegStr $1 SHCTX "Software\Classes\.sbuddy" ""
  StrCmp $1 "" 0 +2
    StrCpy $1 "TrayBuddy.SecureModPackage"

  WriteRegStr SHCTX "Software\Classes\.sbuddy" "" $1
  WriteRegStr SHCTX "Software\Classes\$1" "" "TrayBuddy Secure Mod Package"
  WriteRegStr SHCTX "Software\Classes\$1\DefaultIcon" "" "$INSTDIR\icons\sbuddy.ico,0"

  ; Refresh shell icons
  System::Call 'shell32.dll::SHChangeNotify(i, i, i, i) v (0x08000000, 0, 0, 0)'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; Best-effort cleanup for our fallback ProgIDs (Tauri may remove its own keys).
  DeleteRegKey SHCTX "Software\Classes\TrayBuddy.ModPackage"
  DeleteRegKey SHCTX "Software\Classes\TrayBuddy.SecureModPackage"

  ; Refresh shell icons
  System::Call 'shell32.dll::SHChangeNotify(i, i, i, i) v (0x08000000, 0, 0, 0)'
!macroend
