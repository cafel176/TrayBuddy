$ErrorActionPreference = 'Stop'

function Pause-AndExit([int]$code) {
  Write-Host ''
  Read-Host 'Press Enter to close'
  exit $code
}

try {
  $projectDir = Split-Path -Parent $MyInvocation.MyCommand.Path

  $fps = if ($env:FPS) { $env:FPS } else { '60' }
  $outDir = if ($env:EXPORT_OUTDIR) { $env:EXPORT_OUTDIR } else { 'AnimExports' }

  # Resolve Unity.exe
  $unityExe = $env:UNITY_EXE
  if (-not $unityExe -or -not (Test-Path $unityExe)) {
    $candidates = @(
      "$env:ProgramFiles\Unity\Hub\Editor\2022.3.62f3c1\Editor\Unity.exe",
      "$env:ProgramFiles\Unity\Hub\Editor\2022.3.62f1\Editor\Unity.exe",
      "$env:ProgramFiles\Unity\Editor\Unity.exe",
      "C:\Unity\Hub\Editor\2022.3.62f3c1\Editor\Unity.exe",
      "D:\Unity\2022.3.62f3c1\Editor\Unity.exe"
    )
    $unityExe = $candidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
  }

  if (-not $unityExe -or -not (Test-Path $unityExe)) {
    Write-Host '[Error] Unity.exe not found.'
    Write-Host 'Set env var UNITY_EXE to your Unity Editor path, e.g.:'
    Write-Host '  setx UNITY_EXE "C:\Program Files\Unity\Hub\Editor\2022.3.62f3c1\Editor\Unity.exe"'
    Pause-AndExit 3
  }

  # Inputs
  $model = if ($args.Count -ge 1 -and $args[0]) { $args[0] } else { 'Assets/model.vrm' }
  $anims = if ($args.Count -ge 2) { $args[1..($args.Count-1)] } else { @('Assets/Animations/PET_IDLE_2.anim', 'Assets/Animations/PET_IDLE 1.anim') }

  Write-Host "[Info] UNITY_EXE: $unityExe"
  Write-Host "[Info] PROJECT_DIR: $projectDir"
  Write-Host "[Info] MODEL: $model"
  Write-Host "[Info] ANIMS: $($anims -join ', ')"
  Write-Host "[Info] FPS: $fps"
  Write-Host "[Info] EXPORT_OUTDIR: $outDir"

  # Build Unity CLI args (PowerShell handles quoting safely)
  $cli = @(
    '-batchmode', '-quit',
    '-projectPath', $projectDir,
    '-executeMethod', 'TrayBuddy.AnimConverter.CLI.Run',
    '-model', $model
  )

  foreach ($a in $anims) {
    if ([string]::IsNullOrWhiteSpace($a)) { continue }
    $cli += @('-anim', $a)
  }

  $cli += @(
    '-exportVrma', '1',
    '-exportFbx', '0',
    '-exportGltf', '0',
    '-exportOutDir', $outDir,
    '-fps', $fps
  )

  # Preflight: Unity lock/process checks (common cause of instant failures)
  $lockFiles = @(
    (Join-Path $projectDir 'Temp\UnityLockfile'),
    (Join-Path $projectDir 'Library\UnityLockfile')
  )
  $locks = $lockFiles | Where-Object { Test-Path $_ }
  $unityProcs = Get-Process Unity* -ErrorAction SilentlyContinue
  if ($locks.Count -gt 0 -or $unityProcs) {
    Write-Host '[Warn] Detected possible Unity lock/process. If batchmode fails, close Unity Editor for this project.'
    if ($locks.Count -gt 0) { Write-Host ("[Warn] Lockfiles: {0}" -f ($locks -join ', ')) }
    if ($unityProcs) { Write-Host ("[Warn] Unity processes: {0}" -f (($unityProcs | Select-Object -ExpandProperty Id) -join ', ')) }
  }

  # Always write Unity logs to a file so errors won't disappear on double-click.
  $logDir = Join-Path $projectDir $outDir
  New-Item -ItemType Directory -Force -Path $logDir | Out-Null
  $stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
  $logPath = Join-Path $logDir ("unity_batch_{0}.log" -f $stamp)
  $cli += @('-logFile', $logPath)

  function Quote-UnityArg([string]$s) {
    if ($null -eq $s) { return '""' }
    # Quote args containing spaces or quotes; escape quotes for CreateProcess-style parsing
    if ($s -match '[\s"]') {
      $escaped = $s -replace '"', '\\"'
      return '"' + $escaped + '"'
    }
    return $s
  }

  $argString = ($cli | ForEach-Object { Quote-UnityArg $_ }) -join ' '
  Write-Host "[Info] Log: $logPath"

  $p = Start-Process -FilePath $unityExe -ArgumentList $argString -Wait -PassThru
  $ec = $p.ExitCode


  if ($ec -ne 0) {
    Write-Host "[Error] Unity batchmode failed with exit code $ec."
    Write-Host "[Error] Log: $logPath"
    Write-Host 'If you see "another Unity instance" error, close Unity Editor opening this project.'

    try {
      if (Test-Path $logPath) {
        Write-Host '---- Log tail (last 80 lines) ----'
        Get-Content -Path $logPath -Tail 80 | ForEach-Object { Write-Host $_ }
        Write-Host '---- End log tail ----'
      }
    } catch { }

    Pause-AndExit $ec
  }


  Write-Host '[OK] Done.'
  Write-Host "[OK] Output folder: $projectDir\$outDir"
  Pause-AndExit 0
}
catch {
  Write-Host "[Error] $($_.Exception.Message)"
  Pause-AndExit 99
}
