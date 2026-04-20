// =============================================================================
// HolyOS CAD Bridge — Bezpečné uložení JWT tokenu do DPAPI (per-user)
//
// Proč DPAPI: stejně jako Windows chrání cookies a uložená hesla, šifrujeme
// token tak, aby byl použitelný jen přihlášeným uživatelem na tomto stroji.
// Původní CadExporter ukládal token v plaintext registru — to neděláme.
// =============================================================================

using System;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace HolyOs.CadBridge.Transport;

public sealed record TokenInfo(string Token, string? Username, DateTimeOffset ExpiresAt)
{
    public bool IsExpired => DateTimeOffset.UtcNow > ExpiresAt - TimeSpan.FromMinutes(2);
}

public static class TokenStore
{
    private static readonly byte[] Entropy =
        Encoding.UTF8.GetBytes("HolyOs.CadBridge.v1");

    private static string TokenPath =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                     "HolyOsCadBridge", "token.bin");

    public static TokenInfo? LoadToken()
    {
        try
        {
            if (!File.Exists(TokenPath)) return null;
            var encrypted = File.ReadAllBytes(TokenPath);
            var plain = ProtectedData.Unprotect(encrypted, Entropy, DataProtectionScope.CurrentUser);
            return JsonSerializer.Deserialize<TokenInfo>(plain);
        }
        catch
        {
            return null;
        }
    }

    public static void SaveToken(TokenInfo info)
    {
        var dir = Path.GetDirectoryName(TokenPath)!;
        Directory.CreateDirectory(dir);
        var plain = JsonSerializer.SerializeToUtf8Bytes(info);
        var encrypted = ProtectedData.Protect(plain, Entropy, DataProtectionScope.CurrentUser);
        File.WriteAllBytes(TokenPath, encrypted);
    }

    public static void ClearToken()
    {
        try { if (File.Exists(TokenPath)) File.Delete(TokenPath); } catch { }
    }
}
