; Установщик KZStream для Windows (Inno Setup)
#define AppVer "2.1.0"
[Setup]
AppId={{6F2B7C1E-4D2A-4E8B-9C55-0A1B2C3D4E5F}
AppName=KZStream
AppVersion={#AppVer}
AppVerName=KZStream {#AppVer}
AppPublisher=KZStream
AppPublisherURL=https://kzstream.onrender.com
AppSupportURL=https://t.me/raulanrip
AppUpdatesURL=https://kzstream.onrender.com/download
VersionInfoVersion={#AppVer}
VersionInfoCompany=KZStream
VersionInfoDescription=Установщик KZStream — Kaspi-донаты для TikTok Live
VersionInfoProductName=KZStream
DefaultDirName={localappdata}\Programs\KZStream
DisableDirPage=yes
DisableProgramGroupPage=yes
DefaultGroupName=KZStream
PrivilegesRequired=lowest
OutputDir=output
OutputBaseFilename=KZStream-Setup
SetupIconFile=icon.ico
UninstallDisplayIcon={app}\KZStream.exe
UninstallDisplayName=KZStream
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes
RestartApplications=no

[Languages]
Name: "ru"; MessagesFile: "compiler:Languages\Russian.isl"

[Tasks]
Name: "desktopicon"; Description: "Ярлык на рабочем столе"; GroupDescription: "Дополнительно:"

[Files]
Source: "dist\KZStream\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\KZStream"; Filename: "{app}\KZStream.exe"
Name: "{autodesktop}\KZStream"; Filename: "{app}\KZStream.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\KZStream.exe"; Description: "Запустить KZStream"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
Type: filesandordirs; Name: "{app}"
