// =============================================================================
// HolyOS CAD Bridge — Datové modely pro HTTP komunikaci s HolyOS backendem.
// Přesný tvar je diktován serverem (viz routes/cad.routes.js a zod schémata).
// =============================================================================

using System;
using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace HolyOs.CadBridge.Transport;

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

    // Dvě varianty pro PDF/PNG: buď cesta k již nahranému assetu, nebo Base64
    public string? PngPath { get; set; }
    public string? PdfPath { get; set; }
    public string? PngBase64 { get; set; }
    public string? PdfBase64 { get; set; }

    public List<object> ExternalReferences { get; set; } = new();
    public List<ComponentDto> Components { get; set; } = new();
    public List<ComponentDto> UnknownComponents { get; set; } = new();
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
