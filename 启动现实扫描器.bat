@echo off
setlocal
cd /d "%~dp0"
where py >nul 2>nul
if %errorlevel%==0 (
  start "现实扫描器服务器" /min py -m http.server 4173
) else (
  where python >nul 2>nul
  if errorlevel 1 (
    echo 未找到 Python。请安装 Python 3 后再运行此文件。
    pause
    exit /b 1
  )
  start "现实扫描器服务器" /min python -m http.server 4173
)
timeout /t 2 /nobreak >nul
start "" http://localhost:4173/
echo 现实扫描器已启动： http://localhost:4173/
echo 关闭本窗口不会自动停止服务器；需要时在任务管理器结束 python.exe。
endlocal
