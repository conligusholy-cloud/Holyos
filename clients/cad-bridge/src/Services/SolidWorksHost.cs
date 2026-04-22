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
using System.Reflection;
using System.Runtime.InteropServices;

namespace HolyOs.CadBridge.Services;

public sealed class SolidWorksHost : IDisposable
{
    private object? _swApp;

    public bool IsConnected => _swApp != null;

    /// <summary>Připojí se k běžící instanci SolidWorksu, případně ji spustí na pozadí.</summary>
    public void Connect()
    {
        if (_swApp != null) return;
        var type = Type.GetTypeFromProgID("SldWorks.Application");
        if (type == null)
            throw new InvalidOperationException(
                "Není nainstalován SolidWorks (nebo chybí COM registrace SldWorks.Application).");

        _swApp = Activator.CreateInstance(type);

        // SolidWorks běží skrytě (žádná problikávající okna při otevírání dokumentů).
        // Při ručním spuštění SW uživatelem (už předtím běžící instance) tento setter
        // respektuje aktuální viditelnost, takže ho nezměníme násilně — připojujeme se
        // jen k existující instanci bez zásahu do UI.
        try { SetProp("Visible", false); } catch { }
        try { SetProp("UserControl", false); } catch { }
        try { SetProp("FrameState", 0); } catch { } // 0 = swWindowMinimized — minimalizované okno
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

        // OpenDoc6 — params: FileName, Type, Options, Configuration, Errors(ref), Warnings(ref)
        // Poslední dva parametry jsou v COM signatuře [in, out] int. Při prostém
        // předání hodnoty přes InvokeMember DISPATCH volání selže s
        // DISP_E_TYPEMISMATCH (0x80020005). Musíme je předat přes ParameterModifier
        // se zafixovanými ref flagy.
        object?[] args = new object?[]
        {
            path,              // [in]  FileName
            docType,           // [in]  Type
            1,                 // [in]  Options (Silent)
            string.Empty,      // [in]  Configuration
            0,                 // [ref] Errors
            0,                 // [ref] Warnings
        };
        var mods = new ParameterModifier(args.Length);
        mods[4] = true; // Errors je ref
        mods[5] = true; // Warnings je ref

        object? model;
        try
        {
            model = _swApp!.GetType().InvokeMember(
                "OpenDoc6",
                BindingFlags.InvokeMethod,
                binder: null,
                target: _swApp,
                args: args,
                modifiers: new[] { mods },
                culture: null,
                namedParameters: null);
        }
        catch (TargetInvocationException tie) when (tie.InnerException != null)
        {
            throw tie.InnerException;
        }

        int errors   = args[4] is int e ? e : 0;
        int warnings = args[5] is int w ? w : 0;

        if (model == null)
        {
            throw new InvalidOperationException(
                $"SolidWorks nedokázal otevřít {Path.GetFileName(path)} " +
                $"(errors=0x{errors:X}, warnings=0x{warnings:X}).");
        }

        return new OpenDocument(this, model, path);
    }

    // Vrátí názvy všech konfigurací v modelu
    internal List<string> GetConfigurationNames(object model)
    {
        var obj = Invoke(model, "GetConfigurationNames");
        if (obj is object[] arr) return new List<string>(ConvertStrings(arr));
        return new List<string>();
    }

    // Custom properties — merge General (Uživatelské vlastnosti, configName="") +
    // Config-specific (Vlastnosti konfigurace). Konfigurace přepíše duplicity.
    internal Dictionary<string, object?> GetCustomProperties(object model, string? configName)
    {
        var result = new Dictionary<string, object?>();
        ReadPropertyBag(model, "", result);               // General
        if (!string.IsNullOrWhiteSpace(configName))
            ReadPropertyBag(model, configName!, result);  // Config-specific (přepíše General)
        return result;
    }

    private void ReadPropertyBag(object model, string configName, Dictionary<string, object?> result)
    {
        try
        {
            var ext = GetProp(model, "Extension")!;
            var mgr = Invoke(ext, "CustomPropertyManager", configName);
            if (mgr == null) return;

            var namesObj = Invoke(mgr, "GetNames");
            if (namesObj is not object[] names) return;

            // Získání hodnoty custom property. Metoda Get4 má 2 out parametry
            // (ValOut, ResolvedValOut), které přes plain InvokeMember nejdou —
            // DISPATCH hlásí DISP_E_TYPEMISMATCH (0x80020005). Musíme je předat
            // přes ParameterModifier s ref flagy, stejně jako u OpenDoc6.
            var mgrType = mgr.GetType();
            foreach (var n in ConvertStrings(names))
            {
                try
                {
                    object?[] args = new object?[]
                    {
                        n,             // [in]  FieldName
                        false,         // [in]  UseCached
                        string.Empty,  // [out] ValOut
                        string.Empty,  // [out] ResolvedValOut
                    };
                    var mods = new ParameterModifier(args.Length);
                    mods[2] = true;
                    mods[3] = true;

                    mgrType.InvokeMember(
                        "Get4",
                        BindingFlags.InvokeMethod,
                        binder: null, target: mgr, args: args,
                        modifiers: new[] { mods },
                        culture: null, namedParameters: null);

                    // Preferujeme resolved hodnotu (vyřešené odkazy na rozměry atp.),
                    // fallback na surovou ValOut.
                    var resolved = args[3] as string;
                    var raw      = args[2] as string;
                    result[n] = !string.IsNullOrEmpty(resolved) ? resolved : raw;
                }
                catch (Exception exProp)
                {
                    // Ojedinělé selhání na jedné property nechceme, aby sestřelilo celý import.
                    Diagnostics.LogException($"CustomProperty '{n}' (best-effort)", exProp);
                    result[n] = null;
                }
            }
        }
        catch (Exception ex)
        {
            // Custom props jsou best-effort — při chybě si jen zalogujeme
            // a vrátíme částečný výsledek, aby to nesestřelilo celý run.
            Diagnostics.LogException($"ReadPropertyBag '{configName}' (best-effort)", ex);
        }
    }

    // Zavře dokument (SW odkazuje přes název nebo cestu).
    internal void CloseDocument(string path)
    {
        try { InvokeSw("CloseDoc", Path.GetFileName(path)); } catch { }
    }

    /// <summary>
    /// Spočítá "feature fingerprint" modelu — SHA-256 z seznamu názvů a typů všech
    /// featurek ve stromě FeatureManageru. Tenhle hash se změní jen při **reálné úpravě
    /// modelu** (přidání/úprava/smazání featury), ne při pouhém Save bez změn
    /// (SW sice přepíše timestamp v souboru, ale strom featurek zůstane stejný).
    ///
    /// U sestav (.sldasm) se projde seznam komponent + jejich konfigurace. U dílů
    /// (.sldprt) seznam všech features z FeatureManageru.
    /// </summary>
    internal string? GetFeatureFingerprint(object model)
    {
        try
        {
            var sb = new System.Text.StringBuilder();

            // U dokumentů typu ASSEMBLY: skládáme z komponent + jejich konfigurací.
            // Pro DÍLY a OSTATNÍ: skládáme z features stromu.
            // Základ přes FirstFeature/GetNextFeature (iteruje celý strom).
            var first = Invoke(model, "FirstFeature");
            int depth = 0;
            while (first != null && depth < 10000)
            {
                try
                {
                    var name = (string?)GetProp(first, "Name") ?? "";
                    string type = "";
                    try { type = (string?)Invoke(first, "GetTypeName2") ?? ""; } catch { }
                    if (string.IsNullOrEmpty(type))
                    {
                        try { type = (string?)Invoke(first, "GetTypeName") ?? ""; } catch { }
                    }
                    bool suppressed = false;
                    try
                    {
                        var s = Invoke(first, "IsSuppressed");
                        if (s is bool b) suppressed = b;
                    }
                    catch { }
                    sb.Append(name).Append('|').Append(type)
                      .Append('|').Append(suppressed ? 'S' : 'U');

                    // Projdi DisplayDimensions této featury — hodnoty zachytí změnu
                    // jakéhokoli rozměru uvnitř (hloubka extrude, průměr díry,
                    // rozměr ve sketchi, úhel…). Bez toho by "stejný strom, jiný
                    // rozměr" padal na beze změn.
                    try
                    {
                        var dispDim = Invoke(first, "GetFirstDisplayDimension");
                        int dimDepth = 0;
                        while (dispDim != null && dimDepth < 500)
                        {
                            try
                            {
                                var dim = Invoke(dispDim, "GetDimension2", 0);
                                if (dim != null)
                                {
                                    double val = 0.0;
                                    try
                                    {
                                        // GetSystemValue3(which=1 = current config) vrací hodnotu v m/rad.
                                        var raw = Invoke(dim, "GetSystemValue3", 1, "");
                                        if (raw is double d) val = d;
                                        else if (raw is float f) val = f;
                                        else if (raw is Array arr && arr.Length > 0 && arr.GetValue(0) is double d2) val = d2;
                                    }
                                    catch
                                    {
                                        try { var v = GetProp(dim, "Value"); if (v is double d3) val = d3; } catch { }
                                    }
                                    // Kvantizace na 0.1 μm / 1e-6 rad — eliminuje floating-point šum mezi Save.
                                    long quant = (long)System.Math.Round(val * 1e7);
                                    sb.Append('|').Append(quant);
                                }
                            }
                            catch { }
                            object? nextDim = null;
                            try { nextDim = Invoke(first, "GetNextDisplayDimension", dispDim); } catch { }
                            dispDim = nextDim;
                            dimDepth++;
                        }
                    }
                    catch { /* feature bez dimensions — normální */ }

                    sb.Append('\n');
                }
                catch { /* ojedinělá chyba na feature — jedeme dál */ }

                object? next = null;
                try { next = Invoke(first, "GetNextFeature"); } catch { }
                first = next;
                depth++;
            }

            // Mass properties — finální otisk geometrie. Zachytí i změny, které by
            // ze stromu featur byly špatně vidět (boolean operace, vnořené těla,
            // změna materiálu s jinou hustotou).
            try
            {
                var ext = GetProp(model, "Extension");
                if (ext != null)
                {
                    // CreateMassProperty2 je rychlejší varianta, fallback na CreateMassProperty.
                    object? mp = null;
                    try { mp = Invoke(ext, "CreateMassProperty2"); } catch { }
                    if (mp == null) { try { mp = Invoke(ext, "CreateMassProperty"); } catch { } }
                    if (mp != null)
                    {
                        double mass = 0, volume = 0, surface = 0;
                        try { if (GetProp(mp, "Mass") is double m) mass = m; } catch { }
                        try { if (GetProp(mp, "Volume") is double v) volume = v; } catch { }
                        try { if (GetProp(mp, "SurfaceArea") is double s) surface = s; } catch { }
                        // Kvantizace: mg (1e6), mm³ (1e9), mm² (1e6) — ořízne šum.
                        sb.Append("M|")
                          .Append((long)System.Math.Round(mass * 1e6)).Append('|')
                          .Append((long)System.Math.Round(volume * 1e9)).Append('|')
                          .Append((long)System.Math.Round(surface * 1e6)).Append('\n');
                    }
                }
            }
            catch { /* mass properties nejsou dostupné u všech typů dokumentů */ }

            if (sb.Length == 0) return null;

            using var sha = System.Security.Cryptography.SHA256.Create();
            var hash = sha.ComputeHash(System.Text.Encoding.UTF8.GetBytes(sb.ToString()));
            var hex = new System.Text.StringBuilder(hash.Length * 2);
            foreach (var b in hash) hex.Append(b.ToString("x2"));
            return hex.ToString();
        }
        catch (Exception ex)
        {
            Diagnostics.LogException("GetFeatureFingerprint (best-effort)", ex);
            return null;
        }
    }

    /// <summary>
    /// Projde všechny aktuálně otevřené dokumenty v SolidWorksu a pro každý,
    /// který má neuložené změny (GetSaveFlag==true), zavolá Save. Vrátí počet
    /// uložených dokumentů.
    /// Pokrývá situaci, kdy uživatel upravuje díl v SW ale ještě neklikl Save —
    /// Bridge by jinak viděl starý obsah na disku a nerozpoznal změnu.
    /// </summary>
    public int SaveDirtyOpenDocuments()
    {
        if (_swApp == null) return 0;
        int saved = 0;
        try
        {
            // SldWorks.GetDocuments() vrací pole otevřených ModelDoc2.
            var docsObj = InvokeSw("GetDocuments");
            if (docsObj is not object[] docs) return 0;

            foreach (var doc in docs)
            {
                if (doc == null) continue;
                try
                {
                    // GetSaveFlag() — true, pokud má dokument neuložené změny.
                    var dirtyObj = Invoke(doc, "GetSaveFlag");
                    var isDirty = dirtyObj is bool b && b;
                    if (!isDirty) continue;

                    if (SaveDocument(doc)) saved++;
                }
                catch (Exception exDoc)
                {
                    Diagnostics.LogException("SaveDirtyOpenDocuments (single doc)", exDoc);
                }
            }
        }
        catch (Exception ex)
        {
            Diagnostics.LogException("SaveDirtyOpenDocuments", ex);
        }
        return saved;
    }

    /// <summary>
    /// Uloží aktuální model. Použito k "aktualizaci" sestavy před exportem —
    /// SolidWorks při uložení obnoví reference na všechny podsestavy a díly,
    /// takže na disku vznikne soubor s aktuálními daty a novým checksumem.
    /// Save3(Options, Errors, Warnings) — ref out parametry, stejně jako u OpenDoc6.
    /// </summary>
    internal bool SaveDocument(object model)
    {
        try
        {
            object?[] args = new object?[]
            {
                0,   // Options — swSaveAsOptions_Silent=1 by potlačil dialog; 0 = default
                0,   // [ref] Errors
                0,   // [ref] Warnings
            };
            var mods = new ParameterModifier(args.Length);
            mods[1] = true;
            mods[2] = true;

            var result = model.GetType().InvokeMember(
                "Save3",
                BindingFlags.InvokeMethod,
                binder: null, target: model, args: args,
                modifiers: new[] { mods },
                culture: null, namedParameters: null);

            return result is bool b && b;
        }
        catch
        {
            // Fallback na starší Save() bez parametrů
            try
            {
                var result = model.GetType().InvokeMember(
                    "Save", BindingFlags.InvokeMethod, null, model, null);
                return result is bool b && b;
            }
            catch (Exception ex)
            {
                Diagnostics.LogException("SaveDocument (best-effort)", ex);
                return false;
            }
        }
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

                // Stav potlačení — swComponentSuppressionState_e (enum int):
                //   0 = swComponentSuppressed            (potlačený)
                //   1 = swComponentLightweight
                //   2 = swComponentFullyResolved
                //   3 = swComponentResolvedSafe
                //   4 = swComponentEmbedded
                // Preferujeme property Suppression (SW 2022+ doporučovaná cesta).
                // IsSuppressed() je deprecated a v některých verzích vrací nepoužitelnou hodnotu.
                bool isSuppressed = false;
                try
                {
                    var stateObj = GetProp(ch, "Suppression");
                    if (stateObj is int state)
                    {
                        isSuppressed = (state == 0);
                    }
                    else if (stateObj is short shortState)
                    {
                        isSuppressed = (shortState == 0);
                    }
                }
                catch
                {
                    // Fallback na GetSuppression2(0) — 0 = swThisConfiguration
                    try
                    {
                        var stateObj = Invoke(ch, "GetSuppression2", (int)0);
                        if (stateObj is int state) isSuppressed = (state == 0);
                    }
                    catch { /* vlastnost nemusí být v každé verzi SW dostupná */ }
                }

                // Vyloučit z kusovníku — property ExcludeFromBOM (bool).
                // V novějších verzích SW je to ExcludeFromBOM2.
                bool excludeFromBom = false;
                try
                {
                    var v = GetProp(ch, "ExcludeFromBOM2");
                    if (v is bool b2) excludeFromBom = b2;
                }
                catch { }
                if (!excludeFromBom)
                {
                    try
                    {
                        var v = GetProp(ch, "ExcludeFromBOM");
                        if (v is bool b2) excludeFromBom = b2;
                    }
                    catch { }
                }

                acc.Add(new AssemblyComponent
                {
                    Name = name,
                    Path = path,
                    Configuration = cfg,
                    Quantity = 1,
                    IsSuppressed = isSuppressed,
                    ExcludeFromBom = excludeFromBom,
                });
                // Nepotlačené komponenty rozbalíme rekurzivně (potlačené nemají podstromy).
                if (!isSuppressed) Walk(ch, acc, depth + 1);
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

    /// <summary>Komponenta je v SolidWorksu potlačená (Suppressed).</summary>
    public bool IsSuppressed { get; set; }

    /// <summary>Komponenta je označena "Vyloučit z kusovníku" (ExcludeFromBOM).</summary>
    public bool ExcludeFromBom { get; set; }
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

    /// <summary>Uloží dokument — používá se k aktualizaci sestavy před exportem,
    /// aby SW promítl změny v podsestavách a díly do souboru sestavy.</summary>
    public bool Save() => _host.SaveDocument(Model);

    /// <summary>Feature fingerprint modelu — změní se jen při reálné úpravě geometrie,
    /// ne při pouhém Save (na rozdíl od SHA-256 souboru).</summary>
    public string? FeatureFingerprint => _host.GetFeatureFingerprint(Model);

    public void Dispose() => _host.CloseDocument(Path);
}
