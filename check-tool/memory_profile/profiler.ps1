<#
TrayBuddy Memory Profiler
Build release version, run it, collect memory stats, and generate report
#>

param(
    [int]$Duration = 60,
    [int]$SampleInterval = 2,
    [switch]$SkipBuild,
    [switch]$Verbose
)

$ErrorActionPreference = "Stop"

# Get script directory and project root using relative paths
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = (Resolve-Path "$ScriptDir\..\..").Path
$LogsDir = "$ScriptDir\Logs"
$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$ReportFile = "$LogsDir\memory_report_$timestamp.txt"
$CsvFile = "$LogsDir\memory_samples_$timestamp.csv"

if (!(Test-Path $LogsDir)) {
    New-Item -ItemType Directory -Path $LogsDir -Force | Out-Null
}

function Write-Log {
    param([string]$Message, [string]$Color = "White")
    $ts = Get-Date -Format "HH:mm:ss"
    Write-Host "[$ts] $Message" -ForegroundColor $Color
}

function Get-ProcessMemoryInfo {
    param([System.Diagnostics.Process]$Process)
    if ($null -eq $Process -or $Process.HasExited) { return $null }
    try {
        $Process.Refresh()
        
        # 获取 GDI 和 USER 对象数（用于检测图形资源泄漏）
        $gdiObjects = 0
        $userObjects = 0
        try {
            Add-Type -MemberDefinition @"
[DllImport("user32.dll")]
public static extern int GetGuiResources(IntPtr hProcess, int uiFlags);
"@ -Name "Win32" -Namespace "Native" -ErrorAction SilentlyContinue
            $gdiObjects = [Native.Win32]::GetGuiResources($Process.Handle, 0)  # GDI_OBJECTS = 0
            $userObjects = [Native.Win32]::GetGuiResources($Process.Handle, 1) # USER_OBJECTS = 1
        } catch {}
        
        return @{
            WorkingSet64 = $Process.WorkingSet64
            PrivateMemorySize64 = $Process.PrivateMemorySize64
            VirtualMemorySize64 = $Process.VirtualMemorySize64
            PagedMemorySize64 = $Process.PagedMemorySize64
            PeakWorkingSet64 = $Process.PeakWorkingSet64
            PeakVirtualMemorySize64 = $Process.PeakVirtualMemorySize64
            HandleCount = $Process.HandleCount
            ThreadCount = $Process.Threads.Count
            GDIObjects = $gdiObjects
            USERObjects = $userObjects
        }
    } catch { return $null }
}

function Format-Bytes {
    param([long]$Bytes)
    if ($Bytes -ge 1GB) { return "{0:N2} GB" -f ($Bytes / 1GB) }
    if ($Bytes -ge 1MB) { return "{0:N2} MB" -f ($Bytes / 1MB) }
    if ($Bytes -ge 1KB) { return "{0:N2} KB" -f ($Bytes / 1KB) }
    return "$Bytes B"
}

Write-Log "========================================" "Cyan"
Write-Log "TrayBuddy Memory Profiler" "Cyan"
Write-Log "========================================" "Cyan"
Write-Log "Duration: $Duration sec"
Write-Log "Sample Interval: $SampleInterval sec"
Write-Log "Report: $ReportFile"

# Step 1: Build Release
if (-not $SkipBuild) {
    Write-Log "Building Release version..." "Yellow"
    Push-Location $ProjectRoot
    try {
        # Must use 'pnpm tauri build' to build frontend and embed resources
        # 'cargo build --release' only builds Rust backend without frontend
        Write-Log "Running: pnpm tauri build --no-bundle" "Cyan"
        $process = Start-Process -FilePath "cmd" -ArgumentList "/c","pnpm tauri build --no-bundle" -NoNewWindow -Wait -PassThru
        
        if ($process.ExitCode -ne 0) {
            Write-Log "Build failed! Exit code: $($process.ExitCode)" "Red"
            Write-Log "Try running 'pnpm tauri build' manually to see detailed errors" "Yellow"
            exit 1
        }
        Write-Log "Build complete!" "Green"
    } finally {
        Pop-Location
    }
} else {
    Write-Log "Skipping build step" "Yellow"
}

# Step 2: Find executable
$ExePath = "$ProjectRoot\src-tauri\target\release\TrayBuddy.exe"
if (!(Test-Path $ExePath)) {
    Write-Log "Executable not found: $ExePath" "Red"
    exit 1
}
Write-Log "Executable: $ExePath" "Green"

# Step 3: Start program with memory debug flag
Write-Log "Starting program with memory debug enabled..." "Yellow"
$env:TRAYBUDDY_MEMORY_DEBUG = "1"
$mainProcess = Start-Process -FilePath $ExePath -PassThru
Start-Sleep -Seconds 3

if ($mainProcess.HasExited) {
    Write-Log "Program failed to start!" "Red"
    exit 1
}
Write-Log "Program started, PID: $($mainProcess.Id)" "Green"

# Step 4: Collect samples
$samples = @()
$startTime = Get-Date
$endTime = $startTime.AddSeconds($Duration)

Write-Log "Starting memory monitoring for $Duration seconds..." "Yellow"
Write-Log "----------------------------------------"

# CSV header - 新增 GDI/USER 对象数和内存变化率
"Timestamp,ElapsedSec,ProcessName,PID,WorkingSetMB,PrivateMemMB,VirtualMemMB,Handles,Threads,GDIObjects,USERObjects,DeltaMB,MemRateMB_s" | Out-File -FilePath $CsvFile -Encoding UTF8

# 用于计算内存变化率
$lastTotalMemory = @{}
$lastSampleTime = @{}
$memorySpikes = @()  # 记录内存突增事件

$sampleCount = 0
while ((Get-Date) -lt $endTime) {
    $sampleCount++
    $elapsed = [int]((Get-Date) - $startTime).TotalSeconds
    
    $relatedProcesses = @()
    
    if (-not $mainProcess.HasExited) {
        $relatedProcesses += $mainProcess
    }
    
    try {
        $webviewProcesses = Get-Process -Name "msedgewebview2" -ErrorAction SilentlyContinue
        if ($webviewProcesses) {
            $wmiProcesses = Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe'" -ErrorAction SilentlyContinue
            foreach ($wmiProc in $wmiProcesses) {
                $parentId = $wmiProc.ParentProcessId
                $isOurs = $false
                $checkDepth = 0
                while ($parentId -and $checkDepth -lt 5) {
                    if ($parentId -eq $mainProcess.Id) {
                        $isOurs = $true
                        break
                    }
                    $parentProc = Get-CimInstance Win32_Process -Filter "ProcessId=$parentId" -ErrorAction SilentlyContinue
                    if ($parentProc) {
                        $parentId = $parentProc.ParentProcessId
                    } else {
                        break
                    }
                    $checkDepth++
                }
                if ($isOurs) {
                    $proc = Get-Process -Id $wmiProc.ProcessId -ErrorAction SilentlyContinue
                    if ($proc) { $relatedProcesses += $proc }
                }
            }
        }
    } catch {}
    
    $sampleData = @{
        Timestamp = Get-Date
        Elapsed = $elapsed
        Processes = @()
        TotalWorkingSet = 0
        TotalPrivate = 0
    }
    
    foreach ($proc in $relatedProcesses) {
        $memInfo = Get-ProcessMemoryInfo -Process $proc
        if ($memInfo) {
            $procData = @{
                Name = $proc.ProcessName
                PID = $proc.Id
                MemInfo = $memInfo
            }
            $sampleData.Processes += $procData
            $sampleData.TotalWorkingSet += $memInfo.WorkingSet64
            $sampleData.TotalPrivate += $memInfo.PrivateMemorySize64
            
            # 计算内存变化率
            $procKey = "$($proc.ProcessName)_$($proc.Id)"
            $deltaMB = 0
            $memRateMB = 0
            $currentMemMB = $memInfo.WorkingSet64 / 1MB
            
            if ($lastTotalMemory.ContainsKey($procKey)) {
                $deltaMB = $currentMemMB - $lastTotalMemory[$procKey]
                $timeDiff = ((Get-Date) - $lastSampleTime[$procKey]).TotalSeconds
                if ($timeDiff -gt 0) {
                    $memRateMB = $deltaMB / $timeDiff
                }
                
                # 检测内存突增（单次增量 > 30MB）
                if ($deltaMB -gt 30) {
                    $memorySpikes += @{
                        Timestamp = Get-Date
                        Elapsed = $elapsed
                        Process = $proc.ProcessName
                        PID = $proc.Id
                        DeltaMB = [math]::Round($deltaMB, 2)
                        FromMB = [math]::Round($lastTotalMemory[$procKey], 2)
                        ToMB = [math]::Round($currentMemMB, 2)
                    }
                    Write-Host ""
                    Write-Log "⚠️ Memory Spike: $($proc.ProcessName) +$([math]::Round($deltaMB, 1)) MB" "Yellow"
                }
            }
            $lastTotalMemory[$procKey] = $currentMemMB
            $lastSampleTime[$procKey] = Get-Date
            
            $csvLine = "{0},{1},{2},{3},{4:N2},{5:N2},{6:N2},{7},{8},{9},{10},{11:N2},{12:N4}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $elapsed, $proc.ProcessName, $proc.Id, ($memInfo.WorkingSet64 / 1MB), ($memInfo.PrivateMemorySize64 / 1MB), ($memInfo.VirtualMemorySize64 / 1MB), $memInfo.HandleCount, $memInfo.ThreadCount, $memInfo.GDIObjects, $memInfo.USERObjects, $deltaMB, $memRateMB
            $csvLine | Out-File -FilePath $CsvFile -Append -Encoding UTF8
        }
    }
    
    $samples += $sampleData
    
    $totalMB = [math]::Round($sampleData.TotalWorkingSet / 1MB, 2)
    $procCount = $sampleData.Processes.Count
    Write-Host ("`rSample #{0} | Time: {1}s/{2}s | Processes: {3} | Total Memory: {4} MB    " -f $sampleCount, $elapsed, $Duration, $procCount, $totalMB) -NoNewline
    
    Start-Sleep -Seconds $SampleInterval
    
    if ($mainProcess.HasExited) {
        Write-Log "`nProgram exited!" "Yellow"
        break
    }
}

Write-Host ""
Write-Log "----------------------------------------"
Write-Log "Memory monitoring complete, generating report..." "Yellow"

# Step 5: Close program
Write-Log "Closing program..." "Yellow"
try {
    if (-not $mainProcess.HasExited) {
        $mainProcess.CloseMainWindow() | Out-Null
        $mainProcess.WaitForExit(5000) | Out-Null
        if (-not $mainProcess.HasExited) { $mainProcess.Kill() }
    }
} catch {}

Start-Sleep -Seconds 2

# Step 6: Generate report
$report = @()
$report += "============================================================================"
$report += "TrayBuddy Memory Consumption Report"
$report += "============================================================================"
$report += ""
$report += "Generated: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
$report += "Duration: $Duration seconds"
$report += "Samples: $($samples.Count)"
$report += "Sample Interval: $SampleInterval seconds"
$report += ""

$processStats = @{}

foreach ($sample in $samples) {
    foreach ($proc in $sample.Processes) {
        $key = $proc.Name + "_" + $proc.PID
        if (-not $processStats.ContainsKey($key)) {
            $processStats[$key] = @{
                Name = $proc.Name
                PID = $proc.PID
                Samples = @()
            }
        }
        $processStats[$key].Samples += $proc.MemInfo
    }
}

$report += "============================================================================"
$report += "Per-Process Statistics"
$report += "============================================================================"
$report += ""

$totalAvgWorkingSet = 0

foreach ($key in $processStats.Keys | Sort-Object) {
    $stat = $processStats[$key]
    $samples_mem = $stat.Samples | Where-Object { $_ -ne $null }
    
    if ($samples_mem.Count -eq 0) { continue }
    
    $workingSets = $samples_mem | ForEach-Object { $_.WorkingSet64 }
    $privateMems = $samples_mem | ForEach-Object { $_.PrivateMemorySize64 }
    $handles = $samples_mem | ForEach-Object { $_.HandleCount }
    $threads = $samples_mem | ForEach-Object { $_.ThreadCount }
    
    $avgWorkingSet = ($workingSets | Measure-Object -Average).Average
    $maxWorkingSet = ($workingSets | Measure-Object -Maximum).Maximum
    $minWorkingSet = ($workingSets | Measure-Object -Minimum).Minimum
    $avgPrivate = ($privateMems | Measure-Object -Average).Average
    $maxPrivate = ($privateMems | Measure-Object -Maximum).Maximum
    $avgHandles = [math]::Round(($handles | Measure-Object -Average).Average)
    $avgThreads = [math]::Round(($threads | Measure-Object -Average).Average)
    
    $totalAvgWorkingSet += $avgWorkingSet
    
    $report += "Process: $($stat.Name) (PID: $($stat.PID))"
    $report += "  Working Set:"
    $report += "    Average: $(Format-Bytes $avgWorkingSet)"
    $report += "    Min: $(Format-Bytes $minWorkingSet)"
    $report += "    Max: $(Format-Bytes $maxWorkingSet)"
    $report += "  Private Memory:"
    $report += "    Average: $(Format-Bytes $avgPrivate)"
    $report += "    Max: $(Format-Bytes $maxPrivate)"
    $report += "  Handles: avg $avgHandles"
    $report += "  Threads: avg $avgThreads"
    
    # 新增 GDI/USER 对象统计
    $gdiCounts = $samples_mem | ForEach-Object { $_.GDIObjects } | Where-Object { $_ -gt 0 }
    $userCounts = $samples_mem | ForEach-Object { $_.USERObjects } | Where-Object { $_ -gt 0 }
    if ($gdiCounts.Count -gt 0) {
        $avgGDI = [math]::Round(($gdiCounts | Measure-Object -Average).Average)
        $maxGDI = ($gdiCounts | Measure-Object -Maximum).Maximum
        $report += "  GDI Objects: avg $avgGDI, max $maxGDI"
    }
    if ($userCounts.Count -gt 0) {
        $avgUSER = [math]::Round(($userCounts | Measure-Object -Average).Average)
        $maxUSER = ($userCounts | Measure-Object -Maximum).Maximum
        $report += "  USER Objects: avg $avgUSER, max $maxUSER"
    }
    $report += ""
}

$report += "============================================================================"
$report += "Summary Statistics"
$report += "============================================================================"
$report += ""

$allTotalWorkingSets = $samples | ForEach-Object { $_.TotalWorkingSet }
$allTotalPrivates = $samples | ForEach-Object { $_.TotalPrivate }

if ($allTotalWorkingSets.Count -gt 0) {
    $avgTotal = ($allTotalWorkingSets | Measure-Object -Average).Average
    $maxTotal = ($allTotalWorkingSets | Measure-Object -Maximum).Maximum
    $minTotal = ($allTotalWorkingSets | Measure-Object -Minimum).Minimum
    $avgPrivateTotal = ($allTotalPrivates | Measure-Object -Average).Average
    $maxPrivateTotal = ($allTotalPrivates | Measure-Object -Maximum).Maximum
    
    $report += "Total Working Set (all processes):"
    $report += "  Average: $(Format-Bytes $avgTotal)"
    $report += "  Min: $(Format-Bytes $minTotal)"
    $report += "  Max: $(Format-Bytes $maxTotal)"
    $report += ""
    $report += "Total Private Memory (all processes):"
    $report += "  Average: $(Format-Bytes $avgPrivateTotal)"
    $report += "  Max: $(Format-Bytes $maxPrivateTotal)"
    $report += ""
    
    if ($samples.Count -ge 2) {
        $firstSample = $samples[0].TotalWorkingSet
        $lastSample = $samples[-1].TotalWorkingSet
        $growth = $lastSample - $firstSample
        $growthPercent = if ($firstSample -gt 0) { [math]::Round(($growth / $firstSample) * 100, 2) } else { 0 }
        
        $report += "Memory Growth Trend:"
        $report += "  Initial: $(Format-Bytes $firstSample)"
        $report += "  Final: $(Format-Bytes $lastSample)"
        $report += "  Growth: $(Format-Bytes $growth) ($growthPercent%)"
        $report += ""
    }
}

$report += "============================================================================"
$report += "Process Type Analysis"
$report += "============================================================================"
$report += ""

$mainProcessMem = 0
$webviewProcessMem = 0

foreach ($key in $processStats.Keys) {
    $stat = $processStats[$key]
    $validSamples = $stat.Samples | Where-Object { $_ -ne $null }
    if ($validSamples.Count -eq 0) { continue }
    $avgMem = ($validSamples | ForEach-Object { $_.WorkingSet64 } | Measure-Object -Average).Average
    
    if ($stat.Name -eq "TrayBuddy") {
        $mainProcessMem += $avgMem
    } elseif ($stat.Name -eq "msedgewebview2") {
        $webviewProcessMem += $avgMem
    }
}

$totalMem = $mainProcessMem + $webviewProcessMem
if ($totalMem -gt 0) {
    $mainPercent = [math]::Round(($mainProcessMem / $totalMem) * 100, 1)
    $webviewPercent = [math]::Round(($webviewProcessMem / $totalMem) * 100, 1)
    
    $report += "Memory Distribution:"
    $report += "  Main Process (TrayBuddy.exe):     $(Format-Bytes $mainProcessMem) ($mainPercent%)"
    $report += "  WebView2 Processes (GPU/Render):  $(Format-Bytes $webviewProcessMem) ($webviewPercent%)"
    $report += ""
}

$webviewCount = ($processStats.Keys | Where-Object { $processStats[$_].Name -eq "msedgewebview2" }).Count
if ($webviewCount -gt 0) {
    $report += "WebView2 subprocess count: $webviewCount"
    $report += "  - Usually includes: Browser, GPU, Renderer, Utility processes"
    $report += ""
}

# 新增：内存突增事件报告
$report += "============================================================================"
$report += "Memory Spike Events (Delta > 30MB)"
$report += "============================================================================"
$report += ""

if ($memorySpikes.Count -eq 0) {
    $report += "No memory spikes detected during monitoring."
    $report += ""
} else {
    $report += "Detected $($memorySpikes.Count) memory spike(s):"
    $report += ""
    foreach ($spike in $memorySpikes) {
        $report += "  [$($spike.Elapsed)s] $($spike.Process) (PID: $($spike.PID))"
        $report += "    Delta: +$($spike.DeltaMB) MB ($($spike.FromMB) MB -> $($spike.ToMB) MB)"
        $report += ""
    }
}

$report += "============================================================================"
$report += "Optimization Suggestions"
$report += "============================================================================"
$report += ""

# 新增：GDI 对象泄漏检测
$gdiLeakDetected = $false
foreach ($key in $processStats.Keys) {
    $stat = $processStats[$key]
    $validSamples = $stat.Samples | Where-Object { $_ -ne $null -and $_.GDIObjects -gt 0 }
    if ($validSamples.Count -ge 2) {
        $gdiValues = $validSamples | ForEach-Object { $_.GDIObjects }
        $firstGDI = $gdiValues[0]
        $lastGDI = $gdiValues[-1]
        if ($lastGDI -gt $firstGDI * 1.5 -and ($lastGDI - $firstGDI) -gt 50) {
            $report += "[!] GDI Object leak detected in $($stat.Name) (PID: $($stat.PID))"
            $report += "    GDI Objects: $firstGDI -> $lastGDI (+$($lastGDI - $firstGDI))"
            $report += "    This indicates unreleased graphics resources (images, canvas, textures)"
            $report += ""
            $gdiLeakDetected = $true
        }
    }
}

# 新增：内存突增分析
if ($memorySpikes.Count -gt 0) {
    $report += "[!] Memory spikes detected - $($memorySpikes.Count) event(s)"
    $report += ""
    $report += "Investigation suggestions:"
    $report += "  1. Check what operation triggers the spike (mod switch, animation load, etc.)"
    $report += "  2. Verify image cache is working correctly (LRU hit rate)"
    $report += "  3. Check if old resources are released before loading new ones"
    $report += ""
}

if ($webviewProcessMem -gt $mainProcessMem) {
    $report += "[!] WebView2 processes consume most memory (typical for Tauri apps)"
    $report += ""
    $report += "Potential optimizations:"
    $report += "  1. Reduce Canvas count and size"
    $report += "  2. Optimize image resources (compress spritesheets, use WebP)"
    $report += "  3. Reduce DOM node count"
    $report += "  4. Use CSS animations instead of JS (reduce GPU usage)"
    $report += "  5. Pause rendering when window is not visible"
    $report += ""
}

if ($mainProcessMem -gt 50MB) {
    $report += "[!] Main process memory is relatively high"
    $report += ""
    $report += "Potential optimizations:"
    $report += "  1. Reduce cached data in Rust backend"
    $report += "  2. Use streaming instead of bulk loading"
    $report += "  3. Release unused resources promptly"
    $report += ""
}

if ($samples.Count -ge 2) {
    $growth = $samples[-1].TotalWorkingSet - $samples[0].TotalWorkingSet
    if ($growth -gt 10MB) {
        $report += "[!] Continuous memory growth detected - possible memory leak"
        $report += ""
        $report += "Investigation suggestions:"
        $report += "  1. Check event listeners are properly cleaned up"
        $report += "  2. Check timers are properly cleared"
        $report += "  3. Check for unreleased image cache"
        $report += "  4. Use Chrome DevTools Memory panel for analysis"
        $report += ""
    }
}

$report += "============================================================================"
$report += "Data Files"
$report += "============================================================================"
$report += ""
$report += "Detailed sample data saved to: $CsvFile"
$report += "Open with Excel or other tools for analysis"

$report | Out-File -FilePath $ReportFile -Encoding UTF8

Write-Log "========================================" "Cyan"
Write-Log "Report generated!" "Green"
Write-Log "Report: $ReportFile" "Green"
Write-Log "CSV: $CsvFile" "Green"
Write-Log "========================================" "Cyan"

Write-Host ""
$report | ForEach-Object { Write-Host $_ }
