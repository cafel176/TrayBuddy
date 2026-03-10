param(
  [string]$ListenHost = $(if ($env:HOST) { $env:HOST } else { '127.0.0.1' }),
  [int]$Port = $(if ($env:PORT) { [int]$env:PORT } else { 4173 }),
  [string]$Root = $(if ($env:ROOT) { $env:ROOT } else { (Split-Path -Parent $MyInvocation.MyCommand.Path) })
)


Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$rootFull = (Resolve-Path -LiteralPath $Root).Path
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $rootFull '..')).Path

# Mount table: URL prefix -> filesystem directory  (same as Node dev-server)
$mounts = @(
  @{ UrlPrefix = '/tools-common'; Dir = (Join-Path $projectRoot 'tools-common') }
  @{ UrlPrefix = '/static';       Dir = (Join-Path $projectRoot 'static') }
)

$mime = @{
  '.html' = 'text/html; charset=utf-8'
  '.htm'  = 'text/html; charset=utf-8'
  '.js'   = 'text/javascript; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
  '.png'  = 'image/png'
  '.jpg'  = 'image/jpeg'
  '.jpeg' = 'image/jpeg'
  '.webp' = 'image/webp'
  '.gif'  = 'image/gif'
  '.svg'  = 'image/svg+xml; charset=utf-8'
  '.ico'   = 'image/x-icon'
  '.woff'  = 'font/woff'
  '.woff2' = 'font/woff2'
  '.ttf'   = 'font/ttf'
  '.otf'   = 'font/otf'
  '.wasm'  = 'application/wasm'
}

function Get-SafePath([string]$BaseDir, [string]$UrlPath) {
  $rel = $UrlPath
  if ([string]::IsNullOrEmpty($rel)) { $rel = '/' }
  $rel = $rel.TrimStart('/')

  # Convert URL separators to OS separators
  $rel = $rel -replace '/', [IO.Path]::DirectorySeparatorChar

  $baseNorm = $BaseDir.TrimEnd([IO.Path]::DirectorySeparatorChar)
  $candidate = [IO.Path]::GetFullPath((Join-Path -Path $baseNorm -ChildPath $rel))

  if ($candidate.Length -lt $baseNorm.Length) { return $null }

  $candLower = $candidate.ToLowerInvariant()
  $baseLower = $baseNorm.ToLowerInvariant()

  if ($candLower -eq $baseLower) { return $candidate }
  if ($candLower.StartsWith($baseLower + [IO.Path]::DirectorySeparatorChar)) { return $candidate }

  return $null
}

# Resolve URL path against mount table; returns @{ Dir; Rest } or $null
function Resolve-Mount([string]$UrlPath) {
  foreach ($m in $mounts) {
    $prefix = $m.UrlPrefix
    if (-not $prefix.StartsWith('/')) { $prefix = '/' + $prefix }
    $prefixSlash = if ($prefix.EndsWith('/')) { $prefix } else { $prefix + '/' }

    if ($UrlPath -eq $prefix) {
      return @{ Dir = $m.Dir; Rest = '/' }
    }
    if ($UrlPath.StartsWith($prefixSlash)) {
      $rest = '/' + $UrlPath.Substring($prefixSlash.Length)
      return @{ Dir = $m.Dir; Rest = $rest }
    }
  }
  return $null
}

$listener = [System.Net.HttpListener]::new()
$prefix = "http://${ListenHost}:${Port}/"
$listener.Prefixes.Add($prefix)


try {
  $listener.Start()
} catch {
  Write-Host "[dev-server.ps1] Failed to start listener on ${prefix}"
  Write-Host "[dev-server.ps1] If you see 'Access is denied', try another port or run as admin."
  throw
}

Write-Host "Dev server running at ${prefix}"
Write-Host "ROOT: ${rootFull}"
Write-Host "Open e.g.:"
Write-Host "  ${prefix}index.html"

try {
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $req = $ctx.Request
    $res = $ctx.Response

    try {
      $rawUrl = $req.RawUrl
      if ([string]::IsNullOrEmpty($rawUrl)) { $rawUrl = '/' }

      $urlPath = $rawUrl.Split('?')[0]
      $urlPath = [Uri]::UnescapeDataString($urlPath)

      # Basic CORS / preflight
      $res.Headers.Add('Access-Control-Allow-Origin', '*')
      $res.Headers.Add('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS')
      $res.Headers.Add('Access-Control-Allow-Headers', '*')
      $res.Headers.Add('Cache-Control', 'no-cache')

      if ($req.HttpMethod -eq 'OPTIONS') {
        $res.StatusCode = 204
        $res.OutputStream.Close()
        continue
      }

      $filePath = $null
      $mountMatch = Resolve-Mount $urlPath
      if ($mountMatch) {
        $filePath = Get-SafePath $mountMatch.Dir $mountMatch.Rest
      } else {
        $filePath = Get-SafePath $rootFull $urlPath
      }
      if (-not $filePath) {
        $res.StatusCode = 400
        $res.ContentType = 'text/plain; charset=utf-8'
        $bytes = [Text.Encoding]::UTF8.GetBytes('Bad Request')
        $res.OutputStream.Write($bytes, 0, $bytes.Length)
        $res.OutputStream.Close()
        continue
      }

      if (Test-Path -LiteralPath $filePath -PathType Container) {
        $filePath = Join-Path -Path $filePath -ChildPath 'index.html'
      }

      if (-not (Test-Path -LiteralPath $filePath -PathType Leaf)) {
        $res.StatusCode = 404
        $res.ContentType = 'text/plain; charset=utf-8'
        $bytes = [Text.Encoding]::UTF8.GetBytes("404 Not Found: ${urlPath}")
        $res.OutputStream.Write($bytes, 0, $bytes.Length)
        $res.OutputStream.Close()
        continue
      }

      $ext = [IO.Path]::GetExtension($filePath).ToLowerInvariant()
      $ct = $mime[$ext]
      if (-not $ct) { $ct = 'application/octet-stream' }

      $data = [IO.File]::ReadAllBytes($filePath)
      $res.StatusCode = 200
      $res.ContentType = $ct
      $res.OutputStream.Write($data, 0, $data.Length)
      $res.OutputStream.Close()
    } catch {
      try {
        $res.StatusCode = 500
        $res.ContentType = 'text/plain; charset=utf-8'
        $msg = if ($_.Exception -and $_.Exception.Message) { $_.Exception.ToString() } else { $_.ToString() }
        $bytes = [Text.Encoding]::UTF8.GetBytes($msg)
        $res.OutputStream.Write($bytes, 0, $bytes.Length)
        $res.OutputStream.Close()
      } catch {
        # ignore
      }
    }
  }
} finally {
  $listener.Stop()
  $listener.Close()
}
