// =============================================================================
// HolyOS CAD Bridge — Diagnostics
//
// Pomocné utility pro chybové hlášení a logování.
//
// UnwrapException:  rozbalí zanořené TargetInvocationException, abychom viděli
//                   skutečnou příčinu (pro COM late binding je to klíčové —
//                   jinak dostaneme jen generický "Exception has been thrown
//                   by the target of an invocation.").
//
// LogException:     zapíše detailní stack trace do denního log souboru v
//                   %LOCALAPPDATA%\HolyOsCadBridge\logs\YYYY-MM-DD.log,
//                   aby se dal odeslat vývojáři pro debug.
// =============================================================================

using System;
using System.IO;
using System.Reflection;

namespace HolyOs.CadBridge.Services;

public static class Diagnostics
{
    /// <summary>
    /// Rozbalí vnořená TargetInvocationException a vrátí nejhlubší skutečnou výjimku.
    /// COM late binding (InvokeMember) zabalí každou COM chybu do TIE — pokud to
    /// nerozbalíme, uživatel vidí jen "Exception has been thrown by the target
    /// of an invocation." a nic jiného.
    /// </summary>
    public static Exception Unwrap(Exception ex)
    {
        while (ex is TargetInvocationException tie && tie.InnerException != null)
            ex = tie.InnerException;
        return ex;
    }

    /// <summary>
    /// Krátká, pro UI stravitelná zpráva z (potenciálně vnořené) výjimky.
    /// </summary>
    public static string ShortMessage(Exception ex)
    {
        var real = Unwrap(ex);
        var msg = real.Message?.Trim();
        var typeName = real.GetType().Name;

        // Když je `real` jen holé TargetInvocationException / RuntimeBinderException
        // bez inner exception, message je generická ("Exception has been thrown by
        // the target of an invocation.") a uživatel z ní nic nevyčte. Připojíme
        // aspoň typ + HResult, ať se u kolegy dá problém rychleji identifikovat.
        bool genericWrapperMsg =
            real is TargetInvocationException ||
            string.IsNullOrEmpty(msg) ||
            msg == "Exception has been thrown by the target of an invocation.";

        if (genericWrapperMsg)
        {
            var hresult = real.HResult;
            msg = string.IsNullOrEmpty(msg) ? typeName : msg;
            msg += $" [{typeName}, HRESULT=0x{hresult:X8}]";
        }

        // Některé COM hlášky mají newline uvnitř — UI je zobrazí na jeden řádek
        return (msg ?? typeName).Replace("\r", " ").Replace("\n", " ");
    }

    /// <summary>
    /// Zapíše detailní záznam o výjimce do denního log souboru.
    /// Chyby při logování se ignorují (never throw z logování).
    /// </summary>
    public static void LogException(string context, Exception ex)
    {
        try
        {
            var dir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "HolyOsCadBridge", "logs");
            Directory.CreateDirectory(dir);

            var file = Path.Combine(dir, $"{DateTime.Now:yyyy-MM-dd}.log");
            var stamp = DateTime.Now.ToString("HH:mm:ss.fff");
            var real = Unwrap(ex);
            var sep = new string('─', 72);

            using var sw = new StreamWriter(file, append: true);
            sw.WriteLine($"[{stamp}] {context}");
            sw.WriteLine($"         Typ chyby:   {real.GetType().FullName}");
            sw.WriteLine($"         Zpráva:      {real.Message}");
            if (ex != real)
                sw.WriteLine($"         (Zabalená v:  {ex.GetType().Name})");
            sw.WriteLine("         Stack trace:");
            foreach (var line in (real.StackTrace ?? "").Split('\n'))
                sw.WriteLine("           " + line.TrimEnd());
            sw.WriteLine(sep);
            sw.Flush();
        }
        catch { /* log errors never propagate */ }
    }

    /// <summary>
    /// Cesta ke dnešnímu log souboru (pro odkazy v UI / "otevřít log" tlačítko).
    /// </summary>
    public static string CurrentLogFilePath =>
        Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "HolyOsCadBridge", "logs",
            $"{DateTime.Now:yyyy-MM-dd}.log");
}
