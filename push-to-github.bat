@echo off
title Push to GitHub - task-manager
cd /d C:\Users\13525\WorkBuddy\2026-10-08-17-18-48\task-manager

echo ============================================
echo  Pushing task-manager to GitHub...
echo  (First time: a login window will pop up,
echo   choose browser sign-in and authorize)
echo ============================================
echo.

D:\APP\WorkBuddy\resources\vendor\PortableGit\cmd\git.exe -c credential.helper=manager push -u origin main

echo.
echo ============================================
echo  Done! If you see no error above, success!
echo  Check: github.com/XDF9070/task-manager-gushuaitao
echo ============================================
pause
