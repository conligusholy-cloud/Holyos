// =============================================================================
// HolyOS CAD Bridge — Datové modely pro HTTP komunikaci s HolyOS backendem.
// Přesný tvar je diktován serverem (viz routes/cad.routes.js a zod schémata).
// =============================================================================

using System;
using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace HolyOs.CadBridge.Transport;

// ── Helper pro detekci změn — dvojice hashů z /api/cad/drawings ──────────────
public sealed record ServerHashes(string? Checksum, string? FeatureHash);

// ── /api/auth/login ──────────────────────────────────────────────────────────
public sealed class LoginRequest
{
    public string Username { get; set; } = "";
    public string Password { get; set; } = "";
}

public sealed class LoginResponse
{
    public string? Token { get; set; }
    public string? User_id { get; set; }         // server vrací různé tvary, držíme volně
    public DateTimeOffset? Expires_at { get; set; }
    public object? User { get; set; }
}

// ── /api/cad/project-blocks ──────────────────────────────────────────────────
public sealed class ProjectBlocksResponse
{
    public bool Success { get; set; }
    public List<Project> Projects { get; set; } = new();
}

public sealed class Project
{
    public int Id { get; set; }
    public string Code { get; set; } = "";
    public string Name { get; set; } = "";
    public string? Customer { get; set; }
    public List<Block> Blocks { get; set; } = new();
}

public sealed class Block
{
    public int Id { get; set; }
    public int? Parent_id { get; set; }
    public string Name { get; set; } = "";
    public string? Label { get; set; }
    public List<Block> Children { get; set; } = new();
}

// ── /api/cad/upload-asset (PDF/PNG) ──────────────────────────────────────────
public sealed class UploadAssetRequest
{
    public string Kind { get; set; } = "png";    // "png" | "pdf"
    public string? Filename { get; set; }
    public string ContentBase64 { get; set; } = "";
}

public sealed class UploadAssetResponse
{
    public string? Path { get; set; }
    public string? Url { get; set; }
}

// ── /api/cad/drawings-import (hlavní upload) ─────────────────────────────────
public sealed class DrawingsImportRequest
{
    public ProjectRef Project { get; set; } = new();
    public int? GoodsBlockId { get; set; }
    public bool Overwrite { get; set; }
    public List<DrawingFileDto> DrawingFiles { get; set; } = new();
}

public sealed class ProjectRef
{
    public int? Id { get; set; }
    public string? Code { get; set; }
}

public sealed class DrawingFileDto
{
    public string? Name { get; set; }
    public string DrawingFileName { get; set; } = "";
    public string? RelativePath { get; set; }
    public string Extension { get; set; } = "";
    public int? Version { get; set; }
    public string? SourcePath { get; set; }
    /// <summary>SHA-256 hex primárního souboru (fallback, přepisuje se i při pouhém Save v SW).</summary>
    public string? Checksum { get; set; }
    /// <summary>Hash featurek modelu ze SolidWorks — reálný indikátor změny geometrie.</summary>
    public string? FeatureHash { get; set; }
    /// <summary>Váha změny vyplněná konstruktérem u bleskem označených položek: "minor" | "medium" | "major".</summary>
    public string? ChangeWeight { get; set; }
    /// <summary>Volitelná poznámka konstruktéra k provedené změně (např. "zvětšen průměr díry z 8 na 10").</summary>
    public string? ChangeNote { get; set; }
    public List<ConfigurationDto> Configurations { get; set; } = new();
}

public sealed class ConfigurationDto
{
    public string ConfigurationName { get; set; } = "";
    public string? ConfigurationID { get; set; }
    public int Quantity { get; set; } = 1;
    public bool SelectedToSubmit { get; set; } = true;

    [JsonPropertyName("CustomProperties")]
    public Dictionary<string, object?> CustomProperties { get; set; } = new();

    public decimal? MassGrams { get; set; }

    // Dvě varianty pro PDF/PNG/STL: buď cesta k již nahranému assetu, nebo Base64
    public string? PngPath { get; set; }
    public string? PdfPath { get; set; }
    public string? StlPath { get; set; }
    public string? PngBase64 { get; set; }
    public string? PdfBase64 { get; set; }
    public string? StlBase64 { get; set; }

    // Další přílohy (STEP, DXF, EASM, EPRT, IGES …). Server si je uloží
    // a zobrazí jako tlačítka ke stažení vedle PDF/Náhledu.
    public List<AttachmentDto> Attachments { get; set; } = new();

    public List<object> ExternalReferences { get; set; } = new();
    public List<ComponentDto> Components { get; set; } = new();
    public List<ComponentDto> UnknownComponents { get; set; } = new();
}

public sealed class AttachmentDto
{
    /// <summary>"step" | "dxf" | "easm" | "eprt" | "iges" | …</summary>
    public string Kind { get; set; } = "";
    public string Filename { get; set; } = "";
    /// <summary>Cesta k již nahranému assetu (přes /api/cad/upload-asset).</summary>
    public string? Path { get; set; }
    /// <summary>Raw obsah souboru base64 (alternativa k Path).</summary>
    public string? Base64 { get; set; }
}

public sealed class ComponentDto
{
    public string Name { get; set; } = "";
    public string? Path { get; set; }
    public int Quantity { get; set; } = 1;
    public string? ConfigurationName { get; set; }
    public Dictionary<string, object?>? CustomProperties { get; set; }
}

public sealed class DrawingsImportResponse
{
    public bool Success { get; set; }
    public string? Message { get; set; }
    public List<ImportResultItem> Created { get; set; } = new();
    public List<ImportResultItem> Updated { get; set; } = new();
    public List<ImportResultItem> NotChanged { get; set; } = new();
    public List<ComponentDto> UnknownComponents { get; set; } = new();
    public List<ImportError> Errors { get; set; } = new();
}

public sealed class ImportResultItem
{
    public int Id { get; set; }
    public string DrawingFileName { get; set; } = "";
    public int Version { get; set; }
    public int? ProjectId { get; set; }
    public int? BlockId { get; set; }
}

public sealed class ImportError
{
    public string File { get; set; } = "";
    public string Message { get; set; } = "";
}
