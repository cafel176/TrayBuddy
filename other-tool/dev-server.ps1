param(
  [string]$ListenHost = $(if ($env:HOST) { $env:HOST } else { '127.0.0.1' }),
  [int]$Port = $(if ($env:PORT) { [int]$env:PORT } else { 4173 }),
  [string]$Root = $(if ($env:ROOT) { $env:ROOT } else { (Split-Path -Parent $MyInvocation.MyCommand.Path) })
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$rootFull = (Resolve-Path -LiteralPath $Root).Path

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
  '.ico'  = 'image/x-icon'
}

function Get-SafePath([string]$UrlPath) {
  $rel = $UrlPath
  if ([string]::IsNullOrEmpty($rel)) { $rel = '/' }
  $rel = $rel.TrimStart('/')

  # Convert URL separators to OS separators
  $rel = $rel -replace '/', [IO.Path]::DirectorySeparatorChar

  $candidate = [IO.Path]::GetFullPath((Join-Path -Path $rootFull -ChildPath $rel))
  $rootNorm = $rootFull.TrimEnd([IO.Path]::DirectorySeparatorChar)

  if ($candidate.Length -lt $rootNorm.Length) { return $null }

  $candLower = $candidate.ToLowerInvariant()
  $rootLower = $rootNorm.ToLowerInvariant()

  if ($candLower -eq $rootLower) { return $candidate }
  if ($candLower.StartsWith($rootLower + [IO.Path]::DirectorySeparatorChar)) { return $candidate }

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
Write-Host "  ${prefix}spritesheet切分/"
Write-Host "  ${prefix}spritesheet生成/"

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

      $res.Headers.Add('Access-Control-Allow-Origin', '*')
      $res.Headers.Add('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS')
      $res.Headers.Add('Access-Control-Allow-Headers', '*')
      $res.Headers.Add('Cache-Control', 'no-cache')

      if ($req.HttpMethod -eq 'OPTIONS') {
        $res.StatusCode = 204
        $res.OutputStream.Close()
        continue
      }

      $filePath = Get-SafePath $urlPath
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
