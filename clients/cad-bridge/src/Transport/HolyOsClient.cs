// HolyOS CAD Bridge — HTTP klient proti HolyOS backendu.
using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace HolyOs.CadBridge.Transport;

public sealed class HolyOsClient : IDisposable
{
    private HttpClient _http;
    private string? _baseUrl;
    private string? _bearer;

    public HolyOsClient(string baseUrl)
    {
        _http = CreateHttp();
        SetBaseUrl(baseUrl);
    }

    private static HttpClient CreateHttp() =>
        new HttpClient(new HttpClientHandler { UseCookies = true })
        {
            Timeout = TimeSpan.FromMinutes(5),
        };

    public void SetBaseUrl(string baseUrl)
    {
        _baseUrl = baseUrl?.TrimEnd('/') ?? "";
        var newUri = string.IsNullOrEmpty(_baseUrl) ? null : new Uri(_baseUrl + "/");

        // HttpClient neumi menit BaseAddress po prvnim requestu, tak ho recyklujeme.
        var old = _http;
        _http = CreateHttp();
        _http.BaseAddress = newUri;
        if (!string.IsNullOrEmpty(_bearer))
            _http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", _bearer);
        try { old?.Dispose(); } catch { }
    }

    public void SetBearer(string token)
    {
        _bearer = token;
        _http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
    }

    public void ClearAuth()
    {
        _bearer = null;
        _http.DefaultRequestHeaders.Authorization = null;
    }

    // Auth
    public async Task<TokenInfo> LoginAsync(string username, string password, CancellationToken ct = default)
    {
        var resp = await _http.PostAsJsonAsync("api/auth/login",
            new LoginRequest { Username = username, Password = password }, ct);

        if (!resp.IsSuccessStatusCode)
        {
            var err = await resp.Content.ReadAsStringAsync(ct);
            throw new HttpRequestException($"Prihlaseni selhalo ({(int)resp.StatusCode}): {err}");
        }

        var body = await resp.Content.ReadFromJsonAsync<LoginResponse>(cancellationToken: ct)
            ?? throw new InvalidOperationException("Prazdna odpoved serveru.");
        if (string.IsNullOrEmpty(body.Token))
            throw new InvalidOperationException("Server nevratil token.");

        SetBearer(body.Token);
        var expires = body.Expires_at ?? DateTimeOffset.UtcNow.AddHours(8);
        return new TokenInfo(body.Token, username, expires);
    }

    // /api/cad/project-blocks
    public async Task<ProjectBlocksResponse> GetProjectBlocksAsync(CancellationToken ct = default)
    {
        var resp = await _http.GetAsync("api/cad/project-blocks", ct);
        resp.EnsureSuccessStatusCode();
        return await resp.Content.ReadFromJsonAsync<ProjectBlocksResponse>(cancellationToken: ct)
            ?? throw new InvalidOperationException("Prazdna odpoved serveru.");
    }

    // /api/cad/drawings?projectId=X — vrací existující výkresy v projektu včetně
    // checksumu a feature_hash (hash feature-tree ze SolidWorks).
    // Bridge to používá k detekci změn před odevzdáním.
    public async Task<Dictionary<string, ServerHashes>> GetExistingHashesAsync(
        int projectId, CancellationToken ct = default)
    {
        var result = new Dictionary<string, ServerHashes>(System.StringComparer.OrdinalIgnoreCase);
        try
        {
            var resp = await _http.GetAsync(
                $"api/cad/drawings?projectId={projectId}&limit=500", ct);
            if (!resp.IsSuccessStatusCode) return result;
            using var doc = await System.Text.Json.JsonDocument.ParseAsync(
                await resp.Content.ReadAsStreamAsync(ct), cancellationToken: ct);
            foreach (var el in doc.RootElement.EnumerateArray())
            {
                var fileName = el.TryGetProperty("file_name", out var fn) ? fn.GetString() : null;
                var checksum = el.TryGetProperty("checksum", out var cs) && cs.ValueKind == System.Text.Json.JsonValueKind.String
                    ? cs.GetString() : null;
                var featureHash = el.TryGetProperty("feature_hash", out var fh) && fh.ValueKind == System.Text.Json.JsonValueKind.String
                    ? fh.GetString() : null;
                if (!string.IsNullOrEmpty(fileName))
                    result[fileName!] = new ServerHashes(checksum, featureHash);
            }
        }
        catch { /* bezproblémový fallback — jednou nefungoval detekční endpoint, Bridge jede bez označení */ }
        return result;
    }

    /// <summary>Backward-compat wrapper — vrací jen checksum, pokud někde ještě volá.</summary>
    public async Task<Dictionary<string, string?>> GetExistingChecksumsAsync(
        int projectId, CancellationToken ct = default)
    {
        var src = await GetExistingHashesAsync(projectId, ct);
        var dict = new Dictionary<string, string?>(System.StringComparer.OrdinalIgnoreCase);
        foreach (var kv in src) dict[kv.Key] = kv.Value.Checksum;
        return dict;
    }

    // /api/cad/upload-asset
    public async Task<UploadAssetResponse> UploadAssetAsync(
        string kind, string filename, byte[] content, CancellationToken ct = default)
    {
        var req = new UploadAssetRequest
        {
            Kind = kind,
            Filename = filename,
            ContentBase64 = Convert.ToBase64String(content),
        };
        var resp = await _http.PostAsJsonAsync("api/cad/upload-asset", req, ct);
        resp.EnsureSuccessStatusCode();
        return await resp.Content.ReadFromJsonAsync<UploadAssetResponse>(cancellationToken: ct)
            ?? throw new InvalidOperationException("Prazdna odpoved serveru.");
    }

    // /api/cad/drawings-import
    public async Task<DrawingsImportResponse> ImportDrawingsAsync(
        DrawingsImportRequest payload, CancellationToken ct = default)
    {
        var options = new JsonSerializerOptions
        {
            DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull,
        };
        var resp = await _http.PostAsJsonAsync("api/cad/drawings-import", payload, options, ct);

        var body = await resp.Content.ReadAsStringAsync(ct);
        if (!resp.IsSuccessStatusCode)
        {
            throw new HttpRequestException($"Import selhal ({(int)resp.StatusCode}): {body}");
        }
        return JsonSerializer.Deserialize<DrawingsImportResponse>(body,
            new JsonSerializerOptions { PropertyNameCaseInsensitive = true })
            ?? throw new InvalidOperationException("Prazdna odpoved serveru.");
    }

    public void Dispose() => _http?.Dispose();
}
