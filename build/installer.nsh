; Keep installer upgrades recoverable when an earlier version's uninstaller is
; still locked by Windows or a security scanner.
!macro customHeader
  !undef UNINSTALL_FILENAME
  !define UNINSTALL_FILENAME "Uninstall ${PRODUCT_FILENAME} ${VERSION}.exe"
!macroend

; electron-builder's default PowerShell check treats any process below the
; install directory as the app. Only block an install for the actual app exe.
!macro customCheckAppRunning
  nsProcess::_FindProcess /NOUNLOAD "${APP_EXECUTABLE_FILENAME}"
  Pop $R0
  ${if} $R0 == 0
    MessageBox MB_OK|MB_ICONEXCLAMATION "$(appRunning)"
    Quit
  ${endIf}
!macroend

; Recreate both links after the built-in shortcut logic. This also repairs a
; partially completed installation that left registry data but no shortcuts.
!macro customInstall
  CreateShortCut "$newDesktopLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
  ClearErrors
  WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
  CreateShortCut "$newStartMenuLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
  ClearErrors
  WinShell::SetLnkAUMI "$newStartMenuLink" "${APP_ID}"
  System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
!macroend
