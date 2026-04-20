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
    /// <summary>Uloží aktivní dokument do PDF. Vrátí cestu k souboru.</summary>
    public static byte[]? ExportPdf(OpenDocument doc)
    {
        var tmp = Path.Combine(Path.GetTempPath(), $"holyos-{Guid.NewGuid():N}.pdf");
        try
        {
            int errors = 0, warnings = 0;
            // SaveAs3(FileName, Version, Options, SaveAsOptions, Errors, Warnings)
            doc.Model.GetType().InvokeMember("SaveAs3",
                BindingFlags.InvokeMethod, null, doc.Model,
                new object?[] { tmp, 0, 0, errors, warnings });

            if (!File.Exists(tmp) || new FileInfo(tmp).Length == 0) return null;
            var bytes = File.ReadAllBytes(tmp);
            return bytes;
        }
        catch
        {
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
