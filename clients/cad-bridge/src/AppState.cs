// =============================================================================
// HolyOS CAD Bridge — Globální stav pro předávání zpráv mezi pipe-serverem
// (background thread) a hlavním UI (SubmitForm).
// =============================================================================

using System;
using System.Collections.Concurrent;

namespace HolyOs.CadBridge;

internal static class AppState
{
    /// <summary>Cesta, která přišla při startu (z příkazové řádky).</summary>
    public static string? PendingPath { get; set; }

    private static readonly ConcurrentQueue<string> _incomingPaths = new();

    /// <summary>Event se triggeruje, když NamedPipe dorazí nová cesta z Průzkumníka.</summary>
    public static event Action? PathEnqueued;

    /// <summary>Event se triggeruje, když jiný proces žádá dostat okno do popředí.</summary>
    public static event Action? FocusRequested;

    public static void EnqueuePath(string path)
    {
        _incomingPaths.Enqueue(path);
        PathEnqueued?.Invoke();
    }

    public static bool TryDequeuePath(out string path)
    {
        return _incomingPaths.TryDequeue(out path!);
    }

    public static void RequestFocus()
    {
        FocusRequested?.Invoke();
    }
}
