' T-ML-026 (A): silent launcher for claude-bridge.
'
' node.exe is a console-subsystem executable. Task Scheduler running it (or the
' run-hidden.bat wrapper) directly at logon would flash/keep a visible console
' window -- the same class of problem the trading-bot project solved with
' pythonw.exe, which Node has no equivalent of.
'
' WScript.Shell.Run with windowStyle=0 (hidden) is the standard Windows workaround:
' wscript.exe itself is a GUI-subsystem host (it never owns a console at all), and
' telling it to Run a command with windowStyle=0 makes it pass STARTUPINFO with
' wShowWindow=SW_HIDE down to CreateProcess for the child -- so run-hidden.bat (and
' the node.exe it spawns) starts with no window ever becoming visible, even though
' both are ordinary console-subsystem programs.
'
' The third Run() argument (False) means "do not wait for the child to exit" --
' required here since run-hidden.bat loops forever. wscript.exe returns almost
' immediately; the bat/node process tree keeps running independently afterwards
' (Windows does not tie a spawned process's lifetime to its launcher's).
Dim fso, shell, scriptDir, batPath
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
batPath = scriptDir & "\run-hidden.bat"
shell.Run """" & batPath & """", 0, False
