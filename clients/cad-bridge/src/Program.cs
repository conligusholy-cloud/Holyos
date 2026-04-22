// =============================================================================
// HolyOS CAD Bridge — Main entry point
//
// Tento desktop klient se spouští dvěma způsoby:
//   1) Bez argumentu   → otevře hlavní okno (login, poté SubmitForm)
//   2) S argumentem    → cesta k .sldprt/.sldasm/.slddrw (z kontextového menu
//                        Průzkumníka "Odevzdat do HolyOSu"). Pokud už instance
//                        běží, předá cestu přes NamedPipe běžící instanci.
//
// Single-instance je řízen pomocí Mutex + NamedPipe "HolyOsCadBridgePipe".
// =============================================================================

using System;
using System.IO;
using System.IO.Pipes;
using System.Linq;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using HolyOs.CadBridge.Forms;
using HolyOs.CadBridge.Transport;

namespace HolyOs.CadBridge;

internal static class Program
{
    private const string MutexName = "Global\\HolyOsCadBridge-SingleInstance";
    internal const string PipeName = "HolyOsCadBridgePipe";

    [STAThread]
    private static int Main(string[] args)
    {
        // Jako úplně první věc — chytač všech neošetřených výjimek, aby crash
        // hned při startu aplikace ukázal MessageBox + zapsal do logu, místo
        // aby okno tiše zmizelo a uživatel neměl šanci zjistit proč.
        Application.ThreadException += (_, e) => ShowFatal("Application.ThreadException", e.Exception);
        AppDomain.CurrentDomain.UnhandledException += (_, e) =>
            ShowFatal("AppDomain.UnhandledException", e.ExceptionObject as Exception ?? new Exception("Unknown"));
        TaskScheduler.UnobservedTaskException += (_, e) =>
        {
            ShowFatal("TaskScheduler.UnobservedTaskException", e.Exception);
            e.SetObserved();
        };

        ApplicationConfiguration.Initialize();
        Application.SetHighDpiMode(HighDpiMode.SystemAware);

        var path = args.FirstOrDefault();

        // ── Single-instance handshake ─────────────────────────────────────────
        bool createdNew;
        using var mutex = new Mutex(true, MutexName, out createdNew);

        if (!createdNew)
        {
            // Už běží. Pokud máme cestu, pošleme ji běžící instanci a končíme.
            if (!string.IsNullOrEmpty(path))
            {
                TrySendPathToRunningInstance(path);
            }
            else
            {
                // Pokus o nouzové přenesení okna do popředí — pomocí prázdné zprávy.
                TrySendPathToRunningInstance("__FOCUS__");
            }
            return 0;
        }

        // ── Tato instance je hlavní ──────────────────────────────────────────
        using var cts = new CancellationTokenSource();
        _ = Task.Run(() => PipeServerLoopAsync(cts.Token), cts.Token);

        // Ulož případnou startovní cestu — SubmitForm ji převezme po loginu.
        if (!string.IsNullOrEmpty(path) && File.Exists(path))
        {
            AppState.PendingPath = path;
        }

        var settings = SettingsStore.Load();
        var client = new HolyOsClient(settings.ServerUrl);

        // Auto-login, pokud máme platný token
        var tokenInfo = TokenStore.LoadToken();
        if (tokenInfo != null && !tokenInfo.IsExpired)
        {
            client.SetBearer(tokenInfo.Token);
            Application.Run(new SubmitForm(client, settings));
        }
        else
        {
            var login = new LoginForm(client, settings);
            if (login.ShowDialog() == DialogResult.OK)
            {
                Application.Run(new SubmitForm(client, settings));
            }
        }

        cts.Cancel();
        return 0;
    }

    private static void ShowFatal(string context, Exception ex)
    {
        try { Services.Diagnostics.LogException($"FATAL: {context}", ex); } catch { }
        try
        {
            var real = ex;
            while (real is System.Reflection.TargetInvocationException tie && tie.InnerException != null)
                real = tie.InnerException;
            var msg = $"{real.GetType().Name}: {real.Message}\n\n{real.StackTrace}";
            MessageBox.Show(msg, "HolyOS CAD Bridge — chyba při startu",
                MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
        catch { /* posledni zachrana */ }
    }

    // ── Klient: pošle cestu běžící instanci ──────────────────────────────────
    private static void TrySendPathToRunningInstance(string payload)
    {
        try
        {
            using var pipe = new NamedPipeClientStream(".", PipeName,
                PipeDirection.Out, PipeOptions.None);
            pipe.Connect(1500);
            var bytes = Encoding.UTF8.GetBytes(payload);
            pipe.Write(bytes, 0, bytes.Length);
            pipe.Flush();
        }
        catch
        {
            // Pipe není aktuálně připraven — ignorujeme (edge case).
        }
    }

    // ── Server: naslouchá na pipe, pushuje příchozí cesty do AppState ───────
    private static async Task PipeServerLoopAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            try
            {
                using var pipe = new NamedPipeServerStream(PipeName,
                    PipeDirection.In, 1, PipeTransmissionMode.Byte,
                    PipeOptions.Asynchronous);

                await pipe.WaitForConnectionAsync(ct).ConfigureAwait(false);

                using var ms = new MemoryStream();
                await pipe.CopyToAsync(ms, ct).ConfigureAwait(false);
                var msg = Encoding.UTF8.GetString(ms.ToArray());

                if (msg == "__FOCUS__")
                {
                    AppState.RequestFocus();
                }
                else if (File.Exists(msg))
                {
                    AppState.EnqueuePath(msg);
                }
            }
            catch (OperationCanceledException) { break; }
            catch
            {
                // Nechat smyčku žít přes sporadické chyby.
                await Task.Delay(250, ct).ConfigureAwait(false);
            }
        }
    }
}
