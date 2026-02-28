@echo off
chcp 65001 >nul
title SORPES - Atualizar GitHub
echo.
echo ========================================
echo   SORPES - Enviando alterações ao GitHub
echo ========================================
echo.

cd /d "%~dp0"

echo [1/3] Adicionando arquivos...
git add .
if errorlevel 1 (
    echo Erro ao executar git add.
    pause
    exit /b 1
)

echo.
set "MSG=Atualização SORPES"
set /p "MSG=Mensagem do commit (Enter = Atualização SORPES): "
if "%MSG%"=="" set "MSG=Atualização SORPES"
echo.
echo [2/3] Criando commit...
git commit -m "%MSG%"
if errorlevel 1 (
    echo Nenhuma alteração para enviar ou erro no commit.
    echo Se não houver mudanças, isso é normal.
)

echo.
echo [3/3] Enviando para o GitHub...
git push
if errorlevel 1 (
    echo.
    echo Erro ao enviar. Verifique:
    echo - Conexão com a internet
    echo - Login no GitHub ^(token se solicitado^)
    echo - Repositório configurado: git remote -v
    pause
    exit /b 1
)

echo.
echo ========================================
echo   Concluído. GitHub atualizado.
echo ========================================
echo.
pause
