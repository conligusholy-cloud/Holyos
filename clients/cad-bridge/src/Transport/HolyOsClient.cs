// =============================================================================
// HolyOS CAD Bridge — HTTP klient proti HolyOS backendu.
// Používá Authorization: Bearer <jwt> (konzistence s HolyOS /api/auth).
// =============================================================================

using System;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace HolyOs.CadBridge.Transport;

public sealed class HolyOsClient : IDisposable
{
    private readonly HttpClient _http;
    private string? _baseUrl;

    public HolyOsClient(string baseUrl)
    {
        _http = new HttpClient(new HttpClientHandler { UseCookies = true })
        {
            Timeout = TimeSpan.FromMinutes(5), // velké uploady
        };
        SetBaseUrl(baseUrl);
    }

    public void SetBaseUrl(string baseUrl)
    {
        _baseUrl = baseUrl?.TrimEnd('/') ?? "";
        _http.BaseAddress = string.IsNullOrEmpty(_baseUrl) ? null : new Uri(_baseUrl + "/");
    }

    public void SetBearer(string token)
    {
        _http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
    }

    public void ClearAuth()
    {
        _http.DefaultRequestHeaders.Authorization = null;
    }

    // ── Auth ────────────────────────────────────────────────────────────────
    public async Task<TokenInfo> LoginAsync(string username, string password, CancellationToken ct = default)
    {
        var resp = await _http.PostAsJsonAsync("api/auth/login",
            new LoginRequest { Username = username, Password = password }, ct);

        if (!resp.IsSuccessStatusCode)
        {
            var err = await resp.Content.ReadAsStringAsync(ct);
            throw new HttpRequestException(
                $"Přihlášení selhalo ({(int)resp.StatusCode}): {err}");
        }

        var body = await resp.Content.ReadFromJsonAsync<LoginResponse>(
            cancellationToken: ct)
            ?? throw new InvalidOperationException("Prázdná odpověď serveru.");
        if (string.IsNullOrEmpty(body.Token))
            throw new InvalidOperationException("Server nevrátil token.");

        SetBearer(body.Token);
        var expires = body.Expires_at ?? DateTimeOffset.UtcNow.AddHours(8);
        return new TokenInfo(body.Token, username, expires);
    }

    // ── /api/cad/project-blocks ────────────────────────────────────────────
    public async Task<ProjectBlocksResponse> GetProjectBlocksAsync(CancellationToken ct = default)
    {
        var resp = await _http.GetAsync("api/cad/project-blocks", ct);
        resp.EnsureSuccessStatusCode();
        return await resp.Content.ReadFromJsonAsync<ProjectBlocksResponse>(cancellationToken: ct)
            ?? throw new InvalidOperationException("Prázdná odpověď serveru.");
    }

    // ── /api/cad/upload-asset ─────────────────────────────────────────────
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
            ?? throw new InvalidOperationException("Prázdná odpověď serveru.");
    }

    // ── /api/cad/drawings-import ──────────────────────────────────────────
    public async Task<DrawingsImportResponse> ImportDrawingsAsync(
        DrawingsImportRequest payload, CancellationToken ct = default)
    {
        // Nepoužíváme PostAsJsonAsync s default options, protože chceme ignorovat null hodnoty
        var options = new JsonSerializerOptions { DefaultIgnoreCondition =
            System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull };
        var resp = await _http.PostAsJsonAsync("api/cad/drawings-import", payload, options, ct);

        var body = await resp.Content.ReadAsStringAsync(ct);
        if (!resp.IsSuccessStatusCode)
        {
            throw new HttpRequestException($"Import selhal ({(int)resp.StatusCode}): {body}");
        }
        return JsonSerializer.Deserialize<DrawingsImportResponse>(body,
            new JsonSerializerOptions { PropertyNameCaseInsensitive = true })
            ?? throw new InvalidOperationException("Prázdná odpověď serveru.");
    }

    public void Dispose() => _http.Dispose();
}
