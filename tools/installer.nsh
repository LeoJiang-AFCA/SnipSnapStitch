; electron-builder NSIS include (package.json build.nsis.include).

; Start the new app once with --prewarm (it quits by itself) so antivirus scans the freshly written exe and DLLs while the
; installer is still showing progress. Otherwise that scan (~10-25 s on a locked-down PC) delays the first launch with no
; window on screen. The throwaway profile in $PLUGINSDIR is deleted when the installer exits.
!macro customInstall
  InitPluginsDir
  ExecWait '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --prewarm "--user-data-dir=$PLUGINSDIR\prewarm"'
!macroend
