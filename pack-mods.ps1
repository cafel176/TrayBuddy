# pack-mods.ps1
# 将 mods/ 下每个子文件夹打包为 .tbuddy 文件（ZIP 改后缀），输出到 tbuddy/ 目录
# 用法: powershell -ExecutionPolicy Bypass -File pack-mods.ps1

param(
    [string]$ModsDir   = (Join-Path $PSScriptRoot "mods"),
    [string]$OutputDir = (Join-Path $PSScriptRoot "tbuddy")
)

$ErrorActionPreference = "Stop"

# 确保输出目录存在
if (-not (Test-Path $OutputDir)) {
    New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
}

# 清理旧的 .tbuddy 文件
Get-ChildItem -Path $OutputDir -Filter "*.tbuddy" -File | Remove-Item -Force

$folders = Get-ChildItem -Path $ModsDir -Directory
$count = 0

foreach ($folder in $folders) {
    $modId = $folder.Name
    $modPath = $folder.FullName

    # 跳过没有 manifest.json 的文件夹（非有效 mod）
    if (-not (Test-Path (Join-Path $modPath "manifest.json"))) {
        Write-Host "  Skipping '$modId' (no manifest.json)"
        continue
    }

    $zipPath    = Join-Path $OutputDir "$modId.zip"
    $tbuddyPath = Join-Path $OutputDir "$modId.tbuddy"

    # 先删除残留
    if (Test-Path $zipPath)    { Remove-Item $zipPath -Force }
    if (Test-Path $tbuddyPath) { Remove-Item $tbuddyPath -Force }

    Write-Host "  Packing '$modId' ..."

    # Compress-Archive -Path <folder> 会把文件夹本身作为 zip 内的根目录
    Compress-Archive -Path $modPath -DestinationPath $zipPath -CompressionLevel Optimal

    # 改后缀 .zip -> .tbuddy
    Rename-Item -Path $zipPath -NewName "$modId.tbuddy"

    $count++
}

Write-Host "Done: $count mod(s) packed to '$OutputDir'"
