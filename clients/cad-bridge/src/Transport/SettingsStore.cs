// =============================================================================
// HolyOS CAD Bridge — Perzistentní nastavení klienta (URL serveru atd.)
// Uložené v %LOCALAPPDATA%\HolyOsCadBridge\settings.json.
// =============================================================================

using System;
using System.IO;
using System.Text.Json;

namespace HolyOs.CadBridge.Transport;

public sealed class BridgeSettings
{
    public string ServerUrl { get; set; } = "https://holyos.local";
    public bool GeneratePdfs { get; set; } = true;
    public bool AutoResolveComponents { get; set; } = true;

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
