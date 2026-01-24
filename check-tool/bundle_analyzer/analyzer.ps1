<#
TrayBuddy Bundle Analyzer
Build release version, analyze bundle size and composition, generate report
#>

param(
    [switch]$SkipBuild,
    [switch]$Verbose
)

$ErrorActionPreference = "Stop"

# Get script directory and project root
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = (Resolve-Path "$ScriptDir\..\..").Path
$LogsDir = "$ScriptDir\Logs"
$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$ReportFile = "$LogsDir\bundle_report_$timestamp.txt"
$CsvFile = "$LogsDir\bundle_details_$timestamp.csv"

if (!(Test-Path $LogsDir)) {
    New-Item -ItemType Directory -Path $LogsDir -Force | Out-Null
}

function Write-Log {
    param([string]$Message, [string]$Color = "White")
    $ts = Get-Date -Format "HH:mm:ss"
    Write-Host "[$ts] $Message" -ForegroundColor $Color
}

function Format-Size {
    param([long]$Bytes)
    if ($Bytes -ge 1GB) { return "{0:N2} GB" -f ($Bytes / 1GB) }
    if ($Bytes -ge 1MB) { return "{0:N2} MB" -f ($Bytes / 1MB) }
    if ($Bytes -ge 1KB) { return "{0:N2} KB" -f ($Bytes / 1KB) }
    return "$Bytes B"
}

function Get-FolderSize {
    param([string]$Path)
    if (!(Test-Path $Path)) { return 0 }
    $size = (Get-ChildItem -Path $Path -Recurse -File -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
    return [long]($size -as [long])
}

function Get-FilesByExtension {
    param([string]$Path)
    $result = @{}
    if (!(Test-Path $Path)) { return $result }
    
    Get-ChildItem -Path $Path -Recurse -File -ErrorAction SilentlyContinue | ForEach-Object {
        $ext = if ($_.Extension) { $_.Extension.ToLower() } else { "(no ext)" }
        if (!$result.ContainsKey($ext)) {
            $result[$ext] = @{ Count = 0; Size = 0; Files = @() }
        }
        $result[$ext].Count++
        $result[$ext].Size += $_.Length
        $result[$ext].Files += @{ Name = $_.FullName.Replace($Path, ""); Size = $_.Length }
    }
    return $result
}

Write-Log "========================================" "Cyan"
Write-Log "TrayBuddy Bundle Analyzer" "Cyan"
Write-Log "========================================" "Cyan"
Write-Log "Report: $ReportFile"

# Step 1: Build Release
if (-not $SkipBuild) {
    Write-Log "Building Release version (full bundle)..." "Yellow"
    Push-Location $ProjectRoot
    try {
        Write-Log "Running: pnpm tauri build" "Cyan"
        $buildStart = Get-Date
        $process = Start-Process -FilePath "cmd" -ArgumentList "/c","pnpm tauri build 2>&1" -NoNewWindow -Wait -PassThru
        $buildDuration = (Get-Date) - $buildStart
        
        if ($process.ExitCode -ne 0) {
            Write-Log "Build failed! Exit code: $($process.ExitCode)" "Red"
            exit 1
        }
        Write-Log "Build complete! Duration: $($buildDuration.TotalSeconds.ToString('N1')) seconds" "Green"
    } finally {
        Pop-Location
    }
} else {
    Write-Log "Skipping build step" "Yellow"
}

# Step 2: Locate build artifacts
$BundleDir = "$ProjectRoot\src-tauri\target\release\bundle"
$ReleaseDir = "$ProjectRoot\src-tauri\target\release"
$ModsDir = "$ProjectRoot\mods"
$FrontendDir = "$ProjectRoot\build"

Write-Log "Analyzing bundle artifacts..." "Yellow"

# Step 3: Analyze artifacts
$report = @()
$report += "============================================================================"
$report += "TrayBuddy Bundle Analysis Report"
$report += "============================================================================"
$report += ""
$report += "Generated: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
$report += ""

# CSV header
"Category,Item,SizeBytes,SizeMB,FileCount,Notes" | Out-File -FilePath $CsvFile -Encoding UTF8

# --- Executable ---
$report += "============================================================================"
$report += "1. Main Executable"
$report += "============================================================================"
$report += ""

$exePath = "$ReleaseDir\TrayBuddy.exe"
if (Test-Path $exePath) {
    $exeSize = (Get-Item $exePath).Length
    $report += "TrayBuddy.exe: $(Format-Size $exeSize)"
    "Executable,TrayBuddy.exe,$exeSize,$([math]::Round($exeSize/1MB, 2)),1,Main binary" | Out-File -FilePath $CsvFile -Append -Encoding UTF8
} else {
    $report += "TrayBuddy.exe: NOT FOUND"
}
$report += ""

# --- MSI Installer ---
$report += "============================================================================"
$report += "2. MSI Installer"
$report += "============================================================================"
$report += ""

$msiDir = "$BundleDir\msi"
if (Test-Path $msiDir) {
    $msiFiles = Get-ChildItem -Path $msiDir -Filter "*.msi" -ErrorAction SilentlyContinue
    foreach ($msi in $msiFiles) {
        $report += "$($msi.Name): $(Format-Size $msi.Length)"
        "Installer,$($msi.Name),$($msi.Length),$([math]::Round($msi.Length/1MB, 2)),1,MSI Package" | Out-File -FilePath $CsvFile -Append -Encoding UTF8
    }
    if ($msiFiles.Count -eq 0) {
        $report += "No MSI files found"
    }
} else {
    $report += "MSI directory not found"
}
$report += ""

# --- NSIS Installer ---
$report += "============================================================================"
$report += "3. NSIS Installer"
$report += "============================================================================"
$report += ""

$nsisDir = "$BundleDir\nsis"
if (Test-Path $nsisDir) {
    $nsisFiles = Get-ChildItem -Path $nsisDir -Filter "*.exe" -ErrorAction SilentlyContinue
    foreach ($nsis in $nsisFiles) {
        $report += "$($nsis.Name): $(Format-Size $nsis.Length)"
        "Installer,$($nsis.Name),$($nsis.Length),$([math]::Round($nsis.Length/1MB, 2)),1,NSIS Package" | Out-File -FilePath $CsvFile -Append -Encoding UTF8
    }
    if ($nsisFiles.Count -eq 0) {
        $report += "No NSIS files found"
    }
} else {
    $report += "NSIS directory not found"
}
$report += ""

# --- Frontend Build ---
$report += "============================================================================"
$report += "4. Frontend Build (Embedded in EXE)"
$report += "============================================================================"
$report += ""

if (Test-Path $FrontendDir) {
    $frontendSize = Get-FolderSize $FrontendDir
    $frontendFiles = Get-FilesByExtension $FrontendDir
    
    $report += "Total Size: $(Format-Size $frontendSize)"
    $report += ""
    $report += "By File Type:"
    
    $frontendFiles.GetEnumerator() | Sort-Object { $_.Value.Size } -Descending | ForEach-Object {
        $ext = $_.Key
        $data = $_.Value
        $report += "  $ext : $(Format-Size $data.Size) ($($data.Count) files)"
        "Frontend,$ext,$($data.Size),$([math]::Round($data.Size/1MB, 2)),$($data.Count),Frontend assets" | Out-File -FilePath $CsvFile -Append -Encoding UTF8
    }
    
    # List largest files
    $report += ""
    $report += "Largest Files:"
    Get-ChildItem -Path $FrontendDir -Recurse -File | Sort-Object Length -Descending | Select-Object -First 10 | ForEach-Object {
        $relativePath = $_.FullName.Replace($FrontendDir, "").TrimStart("\", "/")
        $report += "  $(Format-Size $_.Length) - $relativePath"
    }
} else {
    $report += "Frontend build directory not found"
}
$report += ""

# --- Mods (Bundled Resources) ---
$report += "============================================================================"
$report += "5. Mods (Bundled Resources)"
$report += "============================================================================"
$report += ""

if (Test-Path $ModsDir) {
    $totalModsSize = Get-FolderSize $ModsDir
    $report += "Total Mods Size: $(Format-Size $totalModsSize)"
    $report += ""
    
    # Analyze each mod
    $modFolders = Get-ChildItem -Path $ModsDir -Directory -ErrorAction SilentlyContinue
    foreach ($mod in $modFolders) {
        $modSize = Get-FolderSize $mod.FullName
        $modFiles = Get-FilesByExtension $mod.FullName
        
        $report += "Mod: $($mod.Name)"
        $report += "  Total Size: $(Format-Size $modSize)"
        
        $modFiles.GetEnumerator() | Sort-Object { $_.Value.Size } -Descending | ForEach-Object {
            $ext = $_.Key
            $data = $_.Value
            $report += "    $ext : $(Format-Size $data.Size) ($($data.Count) files)"
            "Mods/$($mod.Name),$ext,$($data.Size),$([math]::Round($data.Size/1MB, 2)),$($data.Count),Mod resources" | Out-File -FilePath $CsvFile -Append -Encoding UTF8
        }
        
        # List largest files in mod
        $report += "  Largest Files:"
        Get-ChildItem -Path $mod.FullName -Recurse -File | Sort-Object Length -Descending | Select-Object -First 5 | ForEach-Object {
            $relativePath = $_.FullName.Replace($mod.FullName, "").TrimStart("\", "/")
            $report += "    $(Format-Size $_.Length) - $relativePath"
        }
        $report += ""
    }
} else {
    $report += "Mods directory not found"
}

# --- Release Directory Analysis ---
$report += "============================================================================"
$report += "6. Release Directory Overview"
$report += "============================================================================"
$report += ""

if (Test-Path $ReleaseDir) {
    # Key files in release directory
    $keyFiles = @(
        "TrayBuddy.exe",
        "TrayBuddy.pdb",
        "traybuddy_lib.dll",
        "traybuddy_lib.pdb"
    )
    
    foreach ($fileName in $keyFiles) {
        $filePath = "$ReleaseDir\$fileName"
        if (Test-Path $filePath) {
            $file = Get-Item $filePath
            $report += "$fileName : $(Format-Size $file.Length)"
            "Release,$fileName,$($file.Length),$([math]::Round($file.Length/1MB, 2)),1,Release artifact" | Out-File -FilePath $CsvFile -Append -Encoding UTF8
        }
    }
    
    # Resources folder (bundled mods)
    $resourcesDir = "$ReleaseDir\resources"
    if (Test-Path $resourcesDir) {
        $resourcesSize = Get-FolderSize $resourcesDir
        $report += ""
        $report += "Resources Directory: $(Format-Size $resourcesSize)"
        "Release,resources/,$resourcesSize,$([math]::Round($resourcesSize/1MB, 2)),-,Bundled resources" | Out-File -FilePath $CsvFile -Append -Encoding UTF8
    }
}
$report += ""

# --- Summary ---
$report += "============================================================================"
$report += "7. Summary"
$report += "============================================================================"
$report += ""

$summaryData = @{
    "Executable" = 0
    "Frontend" = 0
    "Mods" = 0
    "MSI" = 0
    "NSIS" = 0
}

if (Test-Path $exePath) { $summaryData["Executable"] = (Get-Item $exePath).Length }
if (Test-Path $FrontendDir) { $summaryData["Frontend"] = Get-FolderSize $FrontendDir }
if (Test-Path $ModsDir) { $summaryData["Mods"] = Get-FolderSize $ModsDir }

$msiFiles = Get-ChildItem -Path "$BundleDir\msi" -Filter "*.msi" -ErrorAction SilentlyContinue
if ($msiFiles) { $summaryData["MSI"] = ($msiFiles | Measure-Object -Property Length -Sum).Sum }

$nsisFiles = Get-ChildItem -Path "$BundleDir\nsis" -Filter "*.exe" -ErrorAction SilentlyContinue
if ($nsisFiles) { $summaryData["NSIS"] = ($nsisFiles | Measure-Object -Property Length -Sum).Sum }

$report += "Component Sizes:"
$summaryData.GetEnumerator() | Sort-Object Value -Descending | ForEach-Object {
    if ($_.Value -gt 0) {
        $report += "  $($_.Key): $(Format-Size $_.Value)"
    }
}

$totalDistributable = $summaryData["MSI"]
if ($summaryData["NSIS"] -gt $totalDistributable) { $totalDistributable = $summaryData["NSIS"] }
if ($totalDistributable -eq 0) { $totalDistributable = $summaryData["Executable"] + $summaryData["Mods"] }

$report += ""
$report += "Distributable Package Size: $(Format-Size $totalDistributable)"
$report += ""

# --- Optimization Suggestions ---
$report += "============================================================================"
$report += "8. Optimization Suggestions"
$report += "============================================================================"
$report += ""

# Check frontend JS size
if (Test-Path $FrontendDir) {
    $jsFiles = Get-ChildItem -Path $FrontendDir -Filter "*.js" -Recurse -ErrorAction SilentlyContinue
    $jsSize = ($jsFiles | Measure-Object -Property Length -Sum).Sum
    if ($jsSize -gt 500KB) {
        $report += "[!] JavaScript bundle is large ($(Format-Size $jsSize))"
        $report += "    Consider: code splitting, tree shaking, minification"
        $report += ""
    }
}

# Check image sizes in mods
if (Test-Path $ModsDir) {
    $imageExts = @(".png", ".jpg", ".jpeg", ".webp", ".gif")
    $largeImages = Get-ChildItem -Path $ModsDir -Recurse -File -ErrorAction SilentlyContinue | Where-Object {
        $imageExts -contains $_.Extension.ToLower() -and $_.Length -gt 500KB
    }
    if ($largeImages.Count -gt 0) {
        $report += "[!] Large image files detected in mods:"
        $largeImages | Sort-Object Length -Descending | Select-Object -First 5 | ForEach-Object {
            $relativePath = $_.FullName.Replace($ModsDir, "mods")
            $report += "    $(Format-Size $_.Length) - $relativePath"
        }
        $report += "    Consider: compress images, use WebP format, reduce dimensions"
        $report += ""
    }
    
    # Check audio sizes
    $audioExts = @(".mp3", ".wav", ".ogg", ".flac")
    $largeAudio = Get-ChildItem -Path $ModsDir -Recurse -File -ErrorAction SilentlyContinue | Where-Object {
        $audioExts -contains $_.Extension.ToLower() -and $_.Length -gt 1MB
    }
    if ($largeAudio.Count -gt 0) {
        $report += "[!] Large audio files detected in mods:"
        $largeAudio | Sort-Object Length -Descending | Select-Object -First 5 | ForEach-Object {
            $relativePath = $_.FullName.Replace($ModsDir, "mods")
            $report += "    $(Format-Size $_.Length) - $relativePath"
        }
        $report += "    Consider: compress audio, use lower bitrate, convert to OGG/MP3"
        $report += ""
    }
}

# Check if PDB files are included
if (Test-Path "$ReleaseDir\TrayBuddy.pdb") {
    $pdbSize = (Get-Item "$ReleaseDir\TrayBuddy.pdb").Length
    $report += "[i] Debug symbols (PDB) present: $(Format-Size $pdbSize)"
    $report += "    These are not included in installer but useful for debugging"
    $report += ""
}

# Check executable size
if (Test-Path $exePath) {
    $exeSize = (Get-Item $exePath).Length
    if ($exeSize -gt 10MB) {
        $report += "[!] Executable is large ($(Format-Size $exeSize))"
        $report += "    Consider: enable LTO, strip symbols, optimize Cargo.toml"
        $report += ""
    }
}

$report += "============================================================================"
$report += "Data Files"
$report += "============================================================================"
$report += ""
$report += "Detailed breakdown saved to: $CsvFile"

# Save report
$report | Out-File -FilePath $ReportFile -Encoding UTF8

Write-Log "========================================" "Cyan"
Write-Log "Analysis complete!" "Green"
Write-Log "Report: $ReportFile" "Green"
Write-Log "CSV: $CsvFile" "Green"
Write-Log "========================================" "Cyan"

Write-Host ""
$report | ForEach-Object { Write-Host $_ }
