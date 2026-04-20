# HolyOS CAD Bridge

Desktop klient pro odevzdávání SolidWorks výkresů/sestav/dílů přímo do HolyOSu.
Instaluje kontextové menu **"Odevzdat do HolyOSu"** do Průzkumníka Windows
(pravé tlačítko na `.sldprt`, `.sldasm`, `.slddrw`, `.stl` nebo na složku).

Nahrazuje původní aplikaci **CadExporter.exe** (Factorify). Endpointy cílí na
HolyOS backend (`/api/cad/project-blocks`, `/api/cad/drawings-import`, …).

## Rozložení

```
clients/cad-bridge/
├── src/
│   ├── HolyOsCadBridge.csproj      # .NET 8 WinForms, single-file publish
│   ├── app.manifest
│   ├── Program.cs                  # entry, single-instance, NamedPipe
│   ├── AppState.cs
│   ├── Forms/
│   │   ├── LoginForm.cs            # URL + user + pwd → /api/auth/login
│   │   └── SubmitForm.cs           # strom projektů + seznam souborů + Vyhledat/Odevzdat
│   ├── Services/
│   │   ├── SolidWorksHost.cs       # COM interop (late binding)
│   │   └── Exporters.cs            # SaveAs PDF, thumbnail
│   └── Transport/
│       ├── HolyOsClient.cs         # HttpClient s Bearer, /api/cad/*
│       ├── Dtos.cs                 # DrawingsImportRequest atd.
│       ├── SettingsStore.cs        # %LOCALAPPDATA%\HolyOsCadBridge\settings.json
│       └── TokenStore.cs           # JWT v DPAPI
└── installer/
    └── HolyOsCadBridge.wxs         # WiX 4 + shell extension registrace
```

## Build

Vyžaduje: Windows, .NET 8 SDK, Visual Studio 2022 (nebo jen `dotnet` CLI), WiX 4.

```pwsh
# 1) Zpublikovat single-file .exe
dotnet publish src\HolyOsCadBridge.csproj -c Release

# 2) Postavit MSI
wix build installer\HolyOsCadBridge.wxs -out HolyOsCadBridge.msi
```

Výstupy:
- `src/bin/Release/net8.0-windows/win-x64/publish/HolyOsCadBridge.exe` (~60 MB kvůli self-contained)
- `HolyOsCadBridge.msi`

## Vývojový běh (F5)

1. Nastav URL serveru ve `SettingsStore.Load()` na svůj dev endpoint, případně v UI po spuštění.
2. V `Program.cs` sleduj `args` — pro simulaci kontextového menu spusť s parametrem:
   ```
   HolyOsCadBridge.exe "C:\svs\test.sldasm"
   ```

## Běhové chování

- **Bez argumentů** → hlavní okno `SubmitForm` (pokud je přihlášen a token platí, jinak nejdřív `LoginForm`).
- **S cestou** → pokud už instance běží, předá cestu přes NamedPipe `HolyOsCadBridgePipe`. Jinak spustí novou instanci a cestu rovnou přidá do gridu souborů.
- **Single-instance** řízen přes globální Mutex `HolyOsCadBridge-SingleInstance`.
- **Token** se šifruje pomocí Windows DPAPI (scope: CurrentUser) a ukládá do `%LOCALAPPDATA%\HolyOsCadBridge\token.bin`. Přežívá restart, vyprší podle `Expires_at` vráceného serverem.

## Pracovní tok (jak popisoval uživatel)

1. V Průzkumníkovi klikne pravým na `12345.sldasm` → **Odevzdat do HolyOSu**.
2. Aplikace se otevře, cesta je předána. Pokud není přihlášen → `LoginForm`.
3. V `SubmitForm` vybere projekt a blok z levého stromu.
4. Klikne **"Vyhledat komponenty"** → aplikace spustí/připojí SolidWorks, otevře sestavu, vyčte všechny díly (rekurzivně přes `GetChildren`), custom properties a konfigurace.
5. Volitelně zaškrtne **"Přepsat stejné verze"**.
6. Klikne **"Odevzdat do HolyOSu"** → PDF výkresu (pokud je to `.slddrw`) se vyexportuje, nahraje přes `POST /api/cad/upload-asset` a payload jde do `POST /api/cad/drawings-import`.
7. Zobrazí se souhrn — Created / Updated / NotChanged / Nerozpoznané komponenty.

## Známé TODO

- [ ] PDF export přes `IModelDocExtension.SaveAs3` — nyní pouze základní try/catch. V produkci přidat retry smyčku (CadExporter měl dobrý důvod).
- [ ] PNG náhled — MVP nepoužívá. Buď `IModelView.GraphicsArea.ActivateView()` + screenshot, nebo parsovat embed thumbnail z OLE struktury `.sldprt`.
- [ ] Retry při "zaseknutém" SolidWorksu (detekce + nabídnout restart SW).
- [ ] V UI editovatelné `Quantity` a `ConfigurationName` na řádku (dvouklik).
- [ ] Ikonka `.ico` (aktuálně `cad-bridge.ico` chybí v repu, `.csproj` na ni ukazuje — ignoruje se pokud nepřítomná, ale Visual Studio si na ni stěžuje).
- [ ] Podepsání MSI (EV code signing cert) — jinak SmartScreen vyhlásí poplach.

## Rozšíření: SolidWorks add-in

Pro UX "tlačítko v ribbonu SolidWorksu" místo kontextového menu lze přidat
knihovnu `HolyOsCadBridge.Addin.dll` implementující `ISwAddin`. Sdílela by
všechny `Services/` a `Transport/` třídy s desktop klientem; diff by byl
jen v `EntryPoint.cs` a registraci přes `SolidWorks.Interop.swpublished`.
