// =============================================================================
// HolyOS CAD Bridge — SolidWorks interop
//
// Pro přístup k SolidWorksu používáme COM automatizaci (late binding přes
// Type.GetTypeFromProgID), takže klient nepotřebuje tvrdou referenci na
// konkrétní verzi SW SDK. To zásadně zjednodušuje deployment (jeden .exe
// funguje s různými ročníky SolidWorksu).
//
// Pokud potřebuješ silně typované reference, doporučuji přidat nuget balík
// `SolidWorks.Interop` (vázáno na konkrétní verzi) a přepsat tohle na něj —
// v early-binding režimu je IntelliSense mnohem příjemnější.
// =============================================================================

using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;

namespace HolyOs.CadBridge.Services;

public sealed class SolidWorksHost : IDisposable
{
    private object? _swApp;

    public bool IsConnected => _swApp != null;

    /// <summary>Připojí se k běžící instanci SolidWorksu, případně ji spustí.</summary>
    public void Connect()
    {
        if (_swApp != null) return;
        var type = Type.GetTypeFromProgID("SldWorks.Application");
        if (type == null)
            throw new InvalidOperationException(
                "Není nainstalován SolidWorks (nebo chybí COM registrace SldWorks.Application).");

        _swApp = Activator.CreateInstance(type);
        SetProp("Visible", true);
    }

    public void Dispose()
    {
        if (_swApp != null)
        {
            try { Marshal.FinalReleaseComObject(_swApp); } catch { }
            _swApp = null;
        }
    }

    // ── Pomocné obaly nad COM (late binding) ───────────────────────────────

    private object InvokeSw(string method, params object?[] args) =>
        _swApp!.GetType().InvokeMember(method,
            System.Reflection.BindingFlags.InvokeMethod, null, _swApp, args)!;

    private void SetProp(string name, object value) =>
        _swApp!.GetType().InvokeMember(name,
            System.Reflection.BindingFlags.SetProperty, null, _swApp, new[] { value });

    private object? GetProp(object target, string name) =>
        target.GetType().InvokeMember(name,
            System.Reflection.BindingFlags.GetProperty, null, target, null);

    private object? Invoke(object target, string method, params object?[] args) =>
        target.GetType().InvokeMember(method,
            System.Reflection.BindingFlags.InvokeMethod, null, target, args);

    // ── Otevření souboru ────────────────────────────────────────────────────

    public OpenDocument OpenDocument(string path)
    {
        if (_swApp == null) throw new InvalidOperationException("SolidWorks není připojen.");
        var ext = Path.GetExtension(path).ToLowerInvariant();
        int docType = ext switch
        {
            ".sldprt" => 1, // swDocPART
            ".sldasm" => 2, // swDocASSEMBLY
            ".slddrw" => 3, // swDocDRAWING
            _ => 0,
        };
        int errors = 0, warnings = 0;

        // OpenDoc6 — params: FileName, Type, Options, Configuration, Errors(out), Warnings(out)
        var model = InvokeSw("OpenDoc6",
            path, docType, 1 /* Silent */, string.Empty, errors, warnings);

        if (model == null)
            throw new InvalidOperationException($"SolidWorks nedokázal otevřít {path}.");

        return new OpenDocument(this, model, path);
    }

    // Vrátí názvy všech konfigurací v modelu
    internal List<string> GetConfigurationNames(object model)
    {
        var obj = Invoke(model, "GetConfigurationNames");
        if (obj is object[] arr) return new List<string>(ConvertStrings(arr));
        return new List<string>();
    }

    // Custom properties aktivní konfigurace (nebo celého souboru, když no config).
    internal Dictionary<string, object?> GetCustomProperties(object model, string? configName)
    {
        var result = new Dictionary<string, object?>();
        try
        {
            var ext = GetProp(model, "Extension")!;
            var mgr = Invoke(ext, "CustomPropertyManager",
                string.IsNullOrEmpty(configName) ? "" : configName);
            if (mgr == null) return result;

            var namesObj = Invoke(mgr, "GetNames");
            if (namesObj is not object[] names) return result;

            foreach (var n in ConvertStrings(names))
            {
                string valOut = string.Empty;
                string resolvedOut = string.Empty;
                // Get4 zná: FieldName, UseCached, out ValOut, out ResolvedValOut, returns bool
                var obj = Invoke(mgr, "Get4", n, false, valOut, resolvedOut);
                // InvokeMember neumí out parametry přes reflexi, zkusíme jednodušší Get:
                var getVal = Invoke(mgr, "Get", n);
                result[n] = getVal;
            }
        }
        catch (Exception ex)
        {
            // Custom props jsou best-effort — při chybě si jen zalogujeme
            // a vrátíme částečný výsledek, aby to nesestřelilo celý run.
            Diagnostics.LogException("GetCustomProperties (best-effort)", ex);
        }
        return result;
    }

    // Zavře dokument (SW odkazuje přes název nebo cestu).
    internal void CloseDocument(string path)
    {
        try { InvokeSw("CloseDoc", Path.GetFileName(path)); } catch { }
    }

    // ── Kusovník sestavy (rekurzivně) ────────────────────────────────────────

    /// <summary>
    /// Vrátí seznam komponent v sestavě. Používá assembly.GetComponents.
    /// </summary>
    internal List<AssemblyComponent> GetComponents(object model, string filePath)
    {
        var list = new List<AssemblyComponent>();

        // Typ dokumentu odvodíme z přípony — volání "GetType" přes InvokeMember
        // kolidovalo se System.Object.GetType() a vracelo .NET Type objekt,
        // na kterém Convert.ToInt32 hodil FormatException.
        var ext = Path.GetExtension(filePath).ToLowerInvariant();
        if (ext != ".sldasm") return list; // jen pro sestavy

        try
        {
            var configMgr = GetProp(model, "ConfigurationManager");
            if (configMgr == null) throw new InvalidOperationException(
                "ModelDoc2.ConfigurationManager vrátil null.");

            // ActiveConfiguration je property — pryč s "get_" prefixem.
            var activeCfg = GetProp(configMgr, "ActiveConfiguration");
            if (activeCfg == null) throw new InvalidOperationException(
                "ConfigurationManager.ActiveConfiguration vrátil null.");

            var rootComp = Invoke(activeCfg, "GetRootComponent3", true);
            if (rootComp == null) throw new InvalidOperationException(
                "Configuration.GetRootComponent3 vrátil null (sestava není plně načtená?).");

            Walk(rootComp, list, 0);
        }
        catch (Exception ex)
        {
            // Výjimka se nesmí tiše spolknout — ProcessRow ji musí vidět.
            Diagnostics.LogException($"GetComponents — {filePath}", ex);
            throw new InvalidOperationException(
                "Nepodařilo se vyčíst komponenty sestavy: " + Diagnostics.ShortMessage(ex), ex);
        }
        return list;
    }

    private void Walk(object component, List<AssemblyComponent> acc, int depth)
    {
        if (depth > 32) return; // ochrana proti zacyklení
        var childrenObj = Invoke(component, "GetChildren");
        if (childrenObj is not object[] arr) return;
        foreach (var ch in arr)
        {
            try
            {
                var name = (string?)GetProp(ch, "Name2") ?? "";
                var path = (string?)GetProp(ch, "GetPathName") ?? null;
                // GetPathName je metoda, ne property — použijeme fallback:
                try { path = (string?)Invoke(ch, "GetPathName"); } catch { }
                var cfg  = (string?)GetProp(ch, "ReferencedConfiguration") ?? null;
                acc.Add(new AssemblyComponent { Name = name, Path = path, Configuration = cfg, Quantity = 1 });
                Walk(ch, acc, depth + 1);
            }
            catch { /* ignoruj vadné uzly */ }
        }
    }

    private static IEnumerable<string> ConvertStrings(object[] arr)
    {
        foreach (var o in arr) if (o is string s) yield return s;
    }
}

public sealed class AssemblyComponent
{
    public string Name { get; set; } = "";
    public string? Path { get; set; }
    public string? Configuration { get; set; }
    public int Quantity { get; set; } = 1;
}

public sealed class OpenDocument : IDisposable
{
    internal object Model { get; }
    private readonly SolidWorksHost _host;
    public string Path { get; }

    internal OpenDocument(SolidWorksHost host, object model, string path)
    {
        _host = host; Model = model; Path = path;
    }

    public List<string> ConfigurationNames => _host.GetConfigurationNames(Model);

    public Dictionary<string, object?> GetCustomProperties(string? configName = null)
        => _host.GetCustomProperties(Model, configName);

    public List<AssemblyComponent> GetComponents() => _host.GetComponents(Model, Path);

    public void Dispose() => _host.CloseDocument(Path);
}
