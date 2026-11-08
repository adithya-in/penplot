@echo off
setlocal
cd /d "%~dp0"

rem Start a static server on 127.0.0.1:8080 unless one is already listening.
powershell -NoProfile -Command "try { $c = New-Object Net.Sockets.TcpClient; $c.Connect('127.0.0.1', 8080); $c.Close(); exit 0 } catch { exit 1 }"
if errorlevel 1 (
  where py >nul 2>nul
  if not errorlevel 1 (
    start "PenPlot server" py -3 -m http.server 8080 --bind 127.0.0.1
  ) else (
    where python >nul 2>nul
    if not errorlevel 1 (
      start "PenPlot server" python -m http.server 8080 --bind 127.0.0.1
    ) else (
      echo Python 3 was not found.
      echo Install Python, or serve this folder with any static web server on port 8080.
      pause
      exit /b 1
    )
  )
  timeout /t 1 /nobreak >nul
)

rem Prefer Chrome, then Edge; fall back to the default browser.
set "BROWSER="
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "BROWSER=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not defined BROWSER if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "BROWSER=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not defined BROWSER if exist "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" set "BROWSER=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"
if not defined BROWSER if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" set "BROWSER=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if not defined BROWSER if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" set "BROWSER=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"

if defined BROWSER (
  start "" "%BROWSER%" "http://localhost:8080/"
) else (
  start "" "http://localhost:8080/"
)

echo PenPlot is running at http://localhost:8080/
echo Keep the "PenPlot server" window open while you draw.
exit /b 0
