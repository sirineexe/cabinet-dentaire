@echo off
chcp 65001 >nul
echo Creation du raccourci sur votre Bureau Windows...

powershell -Command ^
  "$ws = New-Object -ComObject WScript.Shell; " ^
  "$s = $ws.CreateShortcut([System.IO.Path]::Combine([System.Environment]::GetFolderPath('Desktop'), 'Cabinet Dentaire.lnk')); " ^
  "$s.TargetPath = '%~dp0demarrer_cabinet.bat'; " ^
  "$s.WorkingDirectory = '%~dp0'; " ^
  "$s.Description = 'Logiciel de Rendez-vous du Cabinet Dentaire'; " ^
  "$s.Save()"

echo.
echo Le raccourci 'Cabinet Dentaire' a ete cree sur votre Bureau !
echo Vous pouvez maintenant double-cliquer dessus pour ouvrir le logiciel.
pause
