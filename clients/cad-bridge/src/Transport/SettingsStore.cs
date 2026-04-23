// HolyOS CAD Bridge — Perzistentni nastaveni klienta
using System;
using System.IO;
using System.Text.Json;

namespace HolyOs.CadBridge.Transport;

public sealed class BridgeSettings
{
    public string ServerUrl { get; set; } = "https://app.holyos.cz";
    public bool GeneratePdfs { get; set; } = true;
    public bool AutoResolveComponents { get; set; } = true;

    /// <summary>
    /// Přípony, které jsou primární (stanou se samostatným řádkem v gridu a odevzdávají
    /// se jako hlavní "výkres"). Bez tečky, malými písmeny.
    /// </summary>
    public System.Collections.Generic.List<string> PrimaryExtensions { get; set; } = new()
    {
        "sldprt", "sldasm",   // jen díl a sestava jsou primární zdrojové soubory
    };

    /// <summary>
    /// Přípony, které se páří jako přílohy (výkres .slddrw, PDF, DXF, STEP, STL, DWG, PNG…)
    /// k primárnímu souboru se stejným základním jménem. Bez tečky, malými písmeny.
    /// </summary>
    public System.Collections.Generic.List<string> AttachmentExtensions { get; set; } = new()
    {
        "slddrw",             // SolidWorks výkres — přiřazuje se jako příloha k dílu/sestavě
        "pdf", "dxf", "dwg", "stl", "step", "stp", "iges", "igs",
        "easm", "eprt", "x_t", "x_b", "png", "jpg", "jpeg",
    };

    /// <summary>Skenovat při "Naskenovat složku" i podsložky (rekurzivně).</summary>
    public bool ScanSubdirectories { get; set; } = false;

    /// <summary>Po "Vyhledat komponenty" automaticky přidat do gridu i všechny fyzicky
    /// existující komponenty sestav (díly a subsestavy) → odevzdají se jako samostatné výkresy.</summary>
    public bool SubmitComponents { get; set; } = true;

    /// <summary>Ignorovat standardní knihovní díly (SolidWorks Toolbox, ISO šrouby, normalizované)
    /// při expandaci komponent. Detekuje se podle substringů v cestě.</summary>
    public bool IgnoreToolboxParts { get; set; } = true;

    /// <summary>Před exportem tiše otevřít a uložit každou .sldasm v SolidWorksu.
    /// Tím se promítnou změny z podsestav do vrcholových sestav — soubor na disku
    /// dostane aktuální obsah a nový checksum, server správně rozpozná change.</summary>
    public bool RefreshAssembliesBeforeExport { get; set; } = true;

    /// <summary>Uploadovat i samotný SW soubor (SLDPRT/SLDASM/SLDDRW) na server,
    /// aby šel v HolyOSu stáhnout a otevřít v eDrawings / SolidWorksu.
    /// POZOR: velké sestavy zabírají hodně místa, pro stovky souborů se může
    /// úložiště Railway plnit rychle. Default true (pro testing), lze vypnout.</summary>
    public bool UploadSwFileItself { get; set; } = true;

    /// <summary>Zpětná kompatibilita — starý název pole přípon.</summary>
    public System.Collections.Generic.List<string>? ImportExtensions
    {
        get => PrimaryExtensions;
        set { if (value != null) PrimaryExtensions = value; }
    }

    /// <summary>Kořenová složka s CAD výkresy — slouží jako výchozí adresář skenování a dialogu.</summary>
    public string? DefaultCadFolder { get; set; }

    /// <summary>Přepisovat existující verze při odevzdání (default v submit UI).</summary>
    public bool OverwriteSameVersion { get; set; } = false;

    public string NormalizedServerUrl
    {
        get
        {
            var url = (ServerUrl ?? string.Empty).Trim();
            if (!url.StartsWith("http://", StringComparison.OrdinalIgnoreCase) &&
                !url.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
            {
                url = "https://" + url;
            }
            return url.TrimEnd('/');
        }
    }
}

public static class SettingsStore
{
    private static string SettingsPath =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                     "HolyOsCadBridge", "settings.json");

    public static BridgeSettings Load()
    {
        try
        {
            if (File.Exists(SettingsPath))
            {
                var json = File.ReadAllText(SettingsPath);
                return JsonSerializer.Deserialize<BridgeSettings>(json) ?? new BridgeSettings();
            }
        }
        catch { }
        return new BridgeSettings();
    }

    public static void Save(BridgeSettings s)
    {
        var dir = Path.GetDirectoryName(SettingsPath)!;
        Directory.CreateDirectory(dir);
        var json = JsonSerializer.Serialize(s, new JsonSerializerOptions { WriteIndented = true });
        File.WriteAllText(SettingsPath, json);
    }
}
