Set shell = CreateObject("WScript.Shell")
shell.CurrentDirectory = "C:\\Users\\mphat\\papa-bales-pulse-editor"
shell.Run "cmd /c ""C:\Program Files\nodejs\npm.cmd"" run dev", 0, False
