// =============================================================================
// HolyOS CAD Bridge — Exporty PDF a PNG ze SolidWorksu.
//
// SolidWorks zná "SaveAs" s různými příponami — nechává sám vygenerovat PDF
// z aktivního pohledu výkresu. PNG náhled jde extrahovat přes
// IModelDoc2.GetPreviewBitmap nebo přes screenshot.
// =============================================================================

using System;
using System.IO;
using System.Reflection;

namespace HolyOs.CadBridge.Services;

public static class Exporters
{
    /// <summary>
    /// Uloží aktivní dokument (libovolný typ) do souboru přes
    /// <c>IModelDocExtension.SaveAs</c>. Toto je v SW 2018+ doporučená cesta
    /// (IModelDoc2.SaveAs3 je v novějších verzích deprecated a může házet
    /// TargetParameterCountException přes late binding).
    /// <para>
    /// Signatura: <c>bool SaveAs(string Name, int Version, int Options,
    /// object ExportData, object AdvancedSaveAsOptions, ref int Errors, ref int Warnings)</c>
    /// </para>
    /// </summary>
    private static bool ExtensionSaveAs(OpenDocument doc, string targetPath,
        out int errors, out int warnings)
    {
        errors = 0; warnings = 0;

        var ext = doc.Model.GetType().InvokeMember(
            "Extension", BindingFlags.GetProperty, null, doc.Model, null);
        if (ext == null) return false;

        // SW 2022 IDispatch je citlivý na typy parametrů. Projdeme více variant
        // dokud jedna neprojde — IDispatch vrací nejčastěji DISP_E_TYPEMISMATCH
        // když není spokojen s ExportData/AdvancedSaveAsOptions nebo shape
        // ref out parametrů. Zkusíme postupně:
        //   1) null + null  (přímý dispatch null → VT_NULL)
        //   2) DBNull.Value + DBNull.Value
        //   3) Type.Missing + Type.Missing (VT_ERROR / optional)
        // Každá varianta s ParameterModifier pro ref Errors/Warnings.

        var attempts = new object?[][]
        {
            new object?[] { targetPath, (int)0, (int)1, null,          null,          (int)0, (int)0 },
            new object?[] { targetPath, (int)0, (int)1, DBNull.Value,  DBNull.Value,  (int)0, (int)0 },
            new object?[] { targetPath, (int)0, (int)1, Type.Missing,  Type.Missing,  (int)0, (int)0 },
        };

        Exception? lastError = null;
        foreach (var args in attempts)
        {
            try
            {
                var mods = new ParameterModifier(args.Length);
                mods[5] = true;
                mods[6] = true;

                ext.GetType().InvokeMember(
                    "SaveAs",
                    BindingFlags.InvokeMethod,
                    binder: null, target: ext, args: args,
                    modifiers: new[] { mods },
                    culture: null, namedParameters: null);

                errors   = args[5] is int e ? e : 0;
                warnings = args[6] is int w ? w : 0;
                return errors == 0;
            }
            catch (Exception ex)
            {
                lastError = ex is TargetInvocationException tie && tie.InnerException != null
                    ? tie.InnerException : ex;
                // Zkusíme další variantu
            }
        }

        // Poslední záchrana — IModelDoc2.SaveAs(string) (jedna-parametrová legacy
        // metoda, existuje odjakživa). Pokud uspěje, vrací bool.
        try
        {
            doc.Model.GetType().InvokeMember(
                "SaveAs",
                BindingFlags.InvokeMethod,
                binder: null, target: doc.Model,
                args: new object?[] { targetPath });
            return File.Exists(targetPath) && new FileInfo(targetPath).Length > 0;
        }
        catch (Exception ex)
        {
            lastError = ex is TargetInvocationException tie && tie.InnerException != null
                ? tie.InnerException : ex;
        }

        if (lastError != null) throw lastError;
        return false;
    }

    /// <summary>Uloží aktivní dokument do PDF. Vrátí bytové pole nebo null.</summary>
    public static byte[]? ExportPdf(OpenDocument doc)
    {
        var tmp = Path.Combine(Path.GetTempPath(), $"holyos-{Guid.NewGuid():N}.pdf");
        try
        {
            if (!ExtensionSaveAs(doc, tmp, out int errors, out int warnings))
            {
                Diagnostics.LogException("ExportPdf",
                    new InvalidOperationException(
                        $"SaveAs PDF selhal (errors=0x{errors:X}, warnings=0x{warnings:X})"));
                return null;
            }
            if (!File.Exists(tmp) || new FileInfo(tmp).Length == 0) return null;
            return File.ReadAllBytes(tmp);
        }
        catch (Exception ex)
        {
            Diagnostics.LogException("ExportPdf (best-effort)", ex);
            return null;
        }
        finally
        {
            try { if (File.Exists(tmp)) File.Delete(tmp); } catch { }
        }
    }

    /// <summary>
    /// Exportuje dokument (.sldprt/.sldasm) do STL meshe pro webový 3D viewer
    /// (Three.js + STLLoader). Kvalita = Fine (relativně malý soubor, cca
    /// 2–10 MB), binární formát, jednotky z preferencí SW.
    /// </summary>
    public static byte[]? ExportStl(OpenDocument doc)
    {
        var tmp = Path.Combine(Path.GetTempPath(), $"holyos-{Guid.NewGuid():N}.stl");
        try
        {
            // Nastavíme user preferences přes Extension.SetUserPreferenceInteger:
            //   swUserPreferenceIntegerValue_e.swSTLQuality      = 98   0=Coarse, 1=Fine
            //   swUserPreferenceIntegerValue_e.swSTLBinaryFormat = 26   (toggle: Binary)
            // Nastavení STL preferencí přes SldWorks app (NE Extension).
            // Pozor: V SolidWorks API je SetUserPreferenceIntegerValue / -ToggleValue
            // na samotné SldWorks instanci (ne na IModelDocExtension) a má 2 parametry
            // (Id, Value). Na Extension existuje varianta s 3 parametry
            // (Id, Option, Value), ale chce specifické Option enum hodnoty,
            // které pro STL/PDF nejsou definované → DISP_E_TYPEMISMATCH tichá chyba.
            // Proto preferujeme 2-parametrovou variantu přes doc.Model (IModelDoc2
            // přes GetTypeFromProgID poskytuje SldWorks root přes SldWorks property).
            try
            {
                var sw = doc.Model.GetType().InvokeMember("SolidWorks",
                    BindingFlags.GetProperty, null, doc.Model, null)
                    ?? doc.Model.GetType().InvokeMember("GetSldWorks",
                        BindingFlags.InvokeMethod, null, doc.Model, null);
                if (sw != null)
                {
                    try
                    {
                        sw.GetType().InvokeMember("SetUserPreferenceIntegerValue",
                            BindingFlags.InvokeMethod, null, sw,
                            new object?[] { 98, 1 }); // swSTLQuality=98 → Fine=1
                    }
                    catch (Exception pe) { Diagnostics.LogException("STLQuality pref", pe); }
                    try
                    {
                        sw.GetType().InvokeMember("SetUserPreferenceToggle",
                            BindingFlags.InvokeMethod, null, sw,
                            new object?[] { 26, true }); // swSTLBinaryFormat=26
                    }
                    catch (Exception pe) { Diagnostics.LogException("STLBinary pref", pe); }
                }
            }
            catch (Exception sx) { Diagnostics.LogException("STL preferences", sx); }

            if (!ExtensionSaveAs(doc, tmp, out int errors, out int warnings))
            {
                Diagnostics.LogException("ExportStl",
                    new InvalidOperationException(
                        $"SaveAs STL selhal (errors=0x{errors:X}, warnings=0x{warnings:X})"));
                return null;
            }
            if (!File.Exists(tmp) || new FileInfo(tmp).Length == 0) return null;
            return File.ReadAllBytes(tmp);
        }
        catch (Exception ex)
        {
            Diagnostics.LogException("ExportStl (best-effort)", ex);
            return null;
        }
        finally
        {
            try { if (File.Exists(tmp)) File.Delete(tmp); } catch { }
        }
    }

    /// <summary>
    /// Vytáhne PNG náhled dokumentu přímo z uloženého .sldprt/.sldasm
    /// (bez otevírání SW) — používá embeddovaný thumbnail OLE bloku.
    /// </summary>
    public static byte[]? ExtractEmbeddedThumbnail(string filePath)
    {
        // MVP: vrátíme null a necháme server udělat render z PDF.
        // V další iteraci: parsovat OLE compound structured storage a vyzvednout
        // "Workbook\\001Summary..." thumbnail. Knihovna OpenMcdf to umí.
        return null;
    }
}
