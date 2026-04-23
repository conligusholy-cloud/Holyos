// =============================================================================
// HolyOS CAD Bridge — Hlavní okno po loginu
//
// Obsahuje:
//   - vlevo strom projektů/bloků (z /api/cad/project-blocks)
//   - vpravo seznam souboru(ů) k odevzdání
//     + tlačítko "Vyhledat komponenty" (rozbalí sestavu přes SW COM)
//     + tlačítko "Odevzdat do HolyOSu"
// =============================================================================

using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using System.Windows.Forms;
using HolyOs.CadBridge.Services;
using HolyOs.CadBridge.Transport;

namespace HolyOs.CadBridge.Forms;

public sealed class SubmitForm : Form
{
    private readonly HolyOsClient _client;
    private readonly BridgeSettings _settings;
    private readonly SolidWorksHost _sw = new();

    private readonly TreeView _projectTree = new();
    private readonly DataGridView _filesGrid = new();
    private readonly DataGridView _componentsGrid = new();
    private readonly Label _componentsHeader = new()
    {
        Text = "Komponenty vybrané sestavy",
        Dock = DockStyle.Top,
        Height = 26,
        TextAlign = ContentAlignment.MiddleLeft,
        Font = new Font("Segoe UI", 9.5f, FontStyle.Bold),
        Padding = new Padding(10, 0, 0, 0),
    };
    private readonly Button _btnScanFolder = new() { Text = "🗂 Naskenovat složku", Height = 32 };
    private readonly Button _btnAddFile = new() { Text = "+ Přidat soubor…", Height = 32 };
    private readonly Button _btnSearch = new() { Text = "🔍 Vyhledat komponenty", Height = 32 };
    private readonly Button _btnSettings = new() { Text = "⚙ Nastavení", Height = 32 };
    private readonly Button _btnSubmit = new() { Text = "✓ Odevzdat do HolyOSu", Height = 32 };
    private readonly CheckBox _chkOverwrite = new() { Text = "Přepsat stejné verze", AutoSize = true };
    private readonly Label _status = new() { AutoSize = false, Dock = DockStyle.Bottom, Height = 22,
        TextAlign = ContentAlignment.MiddleLeft, ForeColor = Color.FromArgb(100, 116, 139) };
    // Malý progress vpravo dole — teď vypnuto, protože velký banner nahoře
    // ukazuje stejnou informaci čitelněji. Ponechán jen jako data-source pro
    // Step() (_progress.Value / Maximum) bez vizuální indikace.
    private readonly ProgressBar _progress = new()
    {
        Dock = DockStyle.Bottom,
        Height = 1,
        Style = ProgressBarStyle.Continuous,
        Visible = false,
    };

    // Velký viditelný banner během asynchronních operací (scan / search / submit)
    // — aby uživatel neměl pocit, že je Bridge zaseknutý. Zobrazuje aktuální činnost
    // + indeterminate progress. Visible se přepíná v SetBusy().
    private readonly Panel       _busyBanner = new()
    {
        Dock = DockStyle.Top,
        Height = 70,
        BackColor = Color.FromArgb(219, 234, 254),   // světle modrá
        Padding = new Padding(18, 10, 18, 10),
        Visible = false,
    };
    private readonly Label       _busyTitle = new()
    {
        AutoSize = false,
        Dock = DockStyle.Top,
        Height = 22,
        Font = new Font("Segoe UI Semibold", 11f),
        ForeColor = Color.FromArgb(29, 78, 216),
        Text = "⏳ Pracuji…",
    };
    private readonly Label       _busyDetail = new()
    {
        AutoSize = false,
        Dock = DockStyle.Top,
        Height = 18,
        Font = new Font("Segoe UI", 9.5f),
        ForeColor = Color.FromArgb(55, 65, 81),
        Text = "",
    };
    private readonly ProgressBar _busyProgress = new()
    {
        Dock = DockStyle.Bottom,
        Height = 14,
        Style = ProgressBarStyle.Marquee,
        MarqueeAnimationSpeed = 30,
    };

    private readonly List<FileRow> _rows = new();
    // Seznam komponent, které Bridge při Vyhledat komponenty vyloučil z exportu —
    // slouží pro transparentní report uživateli, proč se něco neposlalo.
    private readonly List<(string Name, string Reason, string ParentAssembly)> _excludedComponents = new();
    private int? _selectedProjectId;
    private int? _selectedBlockId;

    public SubmitForm(HolyOsClient client, BridgeSettings settings)
    {
        _client = client;
        _settings = settings;

        Text = "HolyOS CAD Bridge";
        StartPosition = FormStartPosition.CenterScreen;
        Size = new Size(1400, 820);
        Font = new Font("Segoe UI", 9.5f);
        MinimumSize = new Size(1100, 600);
        TryLoadAppIcon();

        BuildUi();

        Shown += async (_, __) =>
        {
            await LoadProjectsAsync();
            HandleIncomingPath(AppState.PendingPath);
            AppState.PendingPath = null;
            AppState.PathEnqueued += () => BeginInvoke((Action)ProcessPendingQueue);
            AppState.FocusRequested += () => BeginInvoke((Action)BringToFront);

            // Pokud Bridge spustili s cestou (z kontextového menu) a přibyl
            // aspoň jeden SW soubor, auto-spustit Vyhledat komponenty.
            if (_rows.Any(r => SwNativeExts.Contains(r.Extension)))
            {
                _ = OnSearchAsync();
            }
        };
        FormClosing += (_, __) => _sw.Dispose();

        _btnAddFile.Click += (_, __) => OnAddFile();
        _btnScanFolder.Click += (_, __) => OnScanFolder();
        _btnSearch.Click += async (_, __) => await OnSearchAsync();
        _btnSubmit.Click += async (_, __) => await OnSubmitAsync();
        _btnSettings.Click += (_, __) =>
        {
            using var dlg = new SettingsForm(_settings);
            if (dlg.ShowDialog(this) == DialogResult.OK)
            {
                // Propagace změn — checkbox "přepsat" v bottombar i URL klienta.
                _chkOverwrite.Checked = _settings.OverwriteSameVersion;
                _client.SetBaseUrl(_settings.ServerUrl);
            }
        };

        _projectTree.AfterSelect += async (_, __) =>
        {
            if (_projectTree.SelectedNode?.Tag is Project p)
            { _selectedProjectId = p.Id; _selectedBlockId = null; }
            else if (_projectTree.SelectedNode?.Tag is (int projId, int blockId))
            { _selectedProjectId = projId; _selectedBlockId = blockId; }
            else
            { _selectedProjectId = null; _selectedBlockId = null; }
            _status.Text = _selectedProjectId.HasValue
                ? $"Cíl: projekt #{_selectedProjectId}" + (_selectedBlockId.HasValue ? $", blok #{_selectedBlockId}" : "")
                : "Vyber projekt vlevo";

            // Po výběru projektu přepočítat změny proti serveru (pokud už jsou načtené soubory).
            if (_selectedProjectId.HasValue && _rows.Count > 0) await DetectChangesAsync();
        };
    }

    /// <summary>Nastaví ikonku okna z embedded resource app-icon.ico (pokud je).</summary>
    private void TryLoadAppIcon()
    {
        try
        {
            using var s = typeof(SubmitForm).Assembly.GetManifestResourceStream("app-icon.ico");
            if (s != null) Icon = new Icon(s);
        }
        catch { /* není ikona — Windows použije default */ }
    }

    private void BuildUi()
    {
        // Hlavní rozložení — TableLayoutPanel místo SplitContainer.
        // Důvod: SplitContainer je notoricky problematický s timing/Width během
        // inicializace (házel ArgumentException při Panel2MinSize). TableLayoutPanel
        // s fixní Absolute šířkou levého sloupce vypadá identicky a nemá timing bugy.
        var main = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            RowCount = 1,
            ColumnCount = 2,
        };
        main.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 260));
        main.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        main.RowStyles.Add(new RowStyle(SizeType.Percent, 100));

        // Levý sloupec — panel s hlavičkou + stromem projektů.
        var leftPanel = new Panel { Dock = DockStyle.Fill };
        var leftHeader = new Label
        {
            Text = "Projekty a bloky",
            Dock = DockStyle.Top,
            Height = 30,
            TextAlign = ContentAlignment.MiddleLeft,
            Font = new Font(Font, FontStyle.Bold),
            Padding = new Padding(10, 0, 0, 0),
        };
        _projectTree.Dock = DockStyle.Fill;
        _projectTree.HideSelection = false;
        _projectTree.BorderStyle = BorderStyle.FixedSingle;
        // Pořadí přidání: TreeView první (Fill), potom Header (Top) —
        // Header "ukrojí" svou výšku z Fill a TreeView automaticky upraví.
        leftPanel.Controls.Add(_projectTree);
        leftPanel.Controls.Add(leftHeader);
        main.Controls.Add(leftPanel, 0, 0);

        // Pravý panel — toolbar nahoře, grid uprostřed, status dole
        var rightLayout = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            RowCount = 3,
            ColumnCount = 1,
        };
        rightLayout.RowStyles.Add(new RowStyle(SizeType.Absolute, 48));
        rightLayout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        rightLayout.RowStyles.Add(new RowStyle(SizeType.Absolute, 48));

        var toolbar = new FlowLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(10, 8, 10, 8) };
        _btnAddFile.Width = 140;
        _btnScanFolder.Width = 180;
        _btnSearch.Width = 200;
        _btnSettings.Width = 130;
        toolbar.Controls.AddRange(new Control[] { _btnScanFolder, _btnAddFile, _btnSearch, _btnSettings });
        rightLayout.Controls.Add(toolbar, 0, 0);

        _filesGrid.Dock = DockStyle.Fill;
        _filesGrid.AllowUserToAddRows = false;
        _filesGrid.SelectionMode = DataGridViewSelectionMode.FullRowSelect;
        _filesGrid.MultiSelect = false;
        _filesGrid.RowHeadersVisible = false;
        _filesGrid.AutoSizeColumnsMode = DataGridViewAutoSizeColumnsMode.Fill;
        _filesGrid.Columns.Add(new DataGridViewTextBoxColumn { Name = "File",     HeaderText = "Soubor", Width = 240 });
        _filesGrid.Columns.Add(new DataGridViewTextBoxColumn { Name = "Ext",      HeaderText = "Typ", Width = 60 });
        _filesGrid.Columns.Add(new DataGridViewTextBoxColumn { Name = "Cfg",      HeaderText = "Konfigurace", Width = 140 });
        _filesGrid.Columns.Add(new DataGridViewTextBoxColumn { Name = "Qty",      HeaderText = "Ks", Width = 60 });
        _filesGrid.Columns.Add(new DataGridViewTextBoxColumn { Name = "CompCount",HeaderText = "Komponent", Width = 100 });
        _filesGrid.Columns.Add(new DataGridViewTextBoxColumn { Name = "Status",   HeaderText = "Stav", Width = 120 });

        // Druhý grid — detail komponent vybraného souboru.
        _componentsGrid.Dock = DockStyle.Fill;
        _componentsGrid.AllowUserToAddRows = false;
        _componentsGrid.ReadOnly = true;
        _componentsGrid.RowHeadersVisible = false;
        _componentsGrid.AutoSizeColumnsMode = DataGridViewAutoSizeColumnsMode.Fill;
        _componentsGrid.BackgroundColor = Color.FromArgb(248, 250, 252);
        _componentsGrid.Columns.Add(new DataGridViewTextBoxColumn { Name = "CompType",    HeaderText = "Typ",         FillWeight = 10 });
        _componentsGrid.Columns.Add(new DataGridViewTextBoxColumn { Name = "CompName",    HeaderText = "Díl",         FillWeight = 30 });
        _componentsGrid.Columns.Add(new DataGridViewTextBoxColumn { Name = "CompPath",    HeaderText = "Cesta",       FillWeight = 35 });
        _componentsGrid.Columns.Add(new DataGridViewTextBoxColumn { Name = "CompCfg",     HeaderText = "Konfigurace", FillWeight = 15 });
        _componentsGrid.Columns.Add(new DataGridViewTextBoxColumn { Name = "CompQty",     HeaderText = "Ks",          FillWeight = 10 });

        // Kontejner pro spodní grid (komponenty) — header nahoře, grid vyplní zbytek.
        var componentsPanel = new Panel { Dock = DockStyle.Fill };
        componentsPanel.Controls.Add(_componentsGrid);
        componentsPanel.Controls.Add(_componentsHeader);
        _componentsHeader.BringToFront();

        // Vertikální rozložení souborů/komponent — zase TableLayoutPanel,
        // aby byl stejně spolehlivý jako hlavní.
        var gridsLayout = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            RowCount = 2,
            ColumnCount = 1,
        };
        gridsLayout.RowStyles.Add(new RowStyle(SizeType.Percent, 55));
        gridsLayout.RowStyles.Add(new RowStyle(SizeType.Percent, 45));
        gridsLayout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        gridsLayout.Controls.Add(_filesGrid, 0, 0);
        gridsLayout.Controls.Add(componentsPanel, 0, 1);

        // Sestavení busyBanneru — title (velký), detail (menší) a progress dole.
        // Přidávání pořadí pro Dock=Top: poslední přidaný je nejvýš → přidávám
        // v opačném pořadí (detail → title → progress).
        _busyBanner.Controls.Add(_busyProgress); // Dock=Bottom
        _busyBanner.Controls.Add(_busyDetail);   // Dock=Top (spodní)
        _busyBanner.Controls.Add(_busyTitle);    // Dock=Top (horní) — přidán poslední

        // Wrapper panel: banner nahoře + grids pod ním.
        var gridsWithBanner = new Panel { Dock = DockStyle.Fill };
        gridsWithBanner.Controls.Add(gridsLayout); // Dock=Fill
        gridsWithBanner.Controls.Add(_busyBanner); // Dock=Top — přes grid když viditelný
        rightLayout.Controls.Add(gridsWithBanner, 0, 1);

        // Propojení: při změně výběru v horním gridu se dolní grid naplní komponentami.
        _filesGrid.SelectionChanged += (_, __) => RenderSelectedComponents();

        var bottomBar = new FlowLayoutPanel
        {
            Dock = DockStyle.Fill,
            FlowDirection = FlowDirection.RightToLeft,
            Padding = new Padding(10, 8, 10, 8),
        };
        _btnSubmit.Width = 220;
        _btnSubmit.BackColor = Color.FromArgb(2, 132, 199);
        _btnSubmit.ForeColor = Color.White;
        _btnSubmit.FlatStyle = FlatStyle.Flat;
        _btnSubmit.FlatAppearance.BorderSize = 0;
        bottomBar.Controls.Add(_btnSubmit);
        bottomBar.Controls.Add(_chkOverwrite);
        rightLayout.Controls.Add(bottomBar, 0, 2);

        main.Controls.Add(rightLayout, 1, 0);

        Controls.Add(main);
        Controls.Add(_status);
        // Nouzový reset — dvojklik na status lištu vynutí odemčení UI.
        // Použít, pokud se Bridge zasekne v "busy" stavu po dokončené operaci.
        _status.DoubleClick += (_, __) =>
        {
            if (_busyDepth > 0)
            {
                _busyDepth = 0;
                SetBusy(false);
                _status.ForeColor = Color.FromArgb(100, 116, 139);
                _status.Text = "UI odemčeno (nouzový reset).";
            }
        };
        Controls.Add(_progress);
        _status.Text = "Připraveno";
    }

    // ── Načtení projektů do stromu ───────────────────────────────────────────
    private async Task LoadProjectsAsync()
    {
        _status.Text = "Načítám projekty…";
        try
        {
            var resp = await _client.GetProjectBlocksAsync();
            Diagnostics.LogException("LoadProjects — OK",
                new InvalidOperationException(
                    $"Server URL={_settings.ServerUrl}, Success={resp.Success}, " +
                    $"Projects={resp.Projects?.Count ?? -1}, " +
                    $"Codes={string.Join(", ", (resp.Projects ?? new List<Project>()).Select(p => p.Code))}"));

            _projectTree.BeginUpdate();
            _projectTree.Nodes.Clear();
            foreach (var p in resp.Projects)
            {
                var node = new TreeNode($"{p.Code} · {p.Name}") { Tag = p };
                AddBlocks(node, p, p.Blocks);
                _projectTree.Nodes.Add(node);
            }
            _projectTree.ExpandAll();
            _projectTree.EndUpdate();

            if (resp.Projects.Count == 0)
            {
                _status.ForeColor = Color.FromArgb(220, 38, 38);
                _status.Text = "Server vrátil 0 projektů — zkontroluj na webu app.holyos.cz, že jsou aktivní (projekty s active=true)";
            }
            else
            {
                _status.ForeColor = Color.FromArgb(22, 163, 74);
                _status.Text = $"Načteno {resp.Projects.Count} projektů ({string.Join(", ", resp.Projects.Take(3).Select(p => p.Code))}{(resp.Projects.Count > 3 ? "…" : "")})";
            }
        }
        catch (Exception ex)
        {
            Diagnostics.LogException("LoadProjects — EXCEPTION", ex);
            _status.ForeColor = Color.FromArgb(220, 38, 38);
            _status.Text = "Chyba načtení projektů: " + Diagnostics.ShortMessage(ex) +
                           " (viz log %LOCALAPPDATA%\\HolyOsCadBridge\\logs)";
        }
    }

    private static void AddBlocks(TreeNode parent, Project p, List<Block> blocks)
    {
        foreach (var b in blocks)
        {
            var node = new TreeNode(b.Name) { Tag = (p.Id, b.Id) };
            if (b.Children?.Count > 0) AddBlocks(node, p, b.Children);
            parent.Nodes.Add(node);
        }
    }

    // ── Přidání souborů do gridu ────────────────────────────────────────────
    // Počet běžících async operací (OnScanFolder, OnSearchAsync, OnSubmitAsync).
    // Dokud je > 0, tlačítko Odevzdat je disabled — uživatel nemůže spustit submit
    // dřív, než se kompletně načtou komponenty a přílohy.
    private int _busyDepth;

    private void SetBusy(bool busy)
    {
        _busyDepth = Math.Max(0, _busyDepth + (busy ? 1 : -1));
        var isBusy = _busyDepth > 0;
        _btnSubmit.Enabled     = !isBusy;
        _btnScanFolder.Enabled = !isBusy;
        _btnAddFile.Enabled    = !isBusy;
        _btnSearch.Enabled     = !isBusy;
        _btnSettings.Enabled   = !isBusy;
        _btnSubmit.Text = isBusy
            ? "⏳ Čekám na načtení komponent…"
            : "✓ Odevzdat do HolyOSu";
        _busyBanner.Visible = isBusy;
        if (!isBusy)
        {
            _busyTitle.Text  = "";
            _busyDetail.Text = "";
            // Reset banner progress na Marquee pro další operaci (Step()
            // si přepne na Continuous jakmile zná reálný počet kroků).
            _busyProgress.Style = ProgressBarStyle.Marquee;
            _busyProgress.MarqueeAnimationSpeed = 30;
        }
    }

    /// <summary>
    /// Naformátuje odhad zbývajícího času na základě uplynulého času a podílu hotových.
    /// Používá se v banneru během dlouhých operací (scan / search / submit).
    /// </summary>
    private static string FormatEta(DateTime startUtc, int doneCount, int totalCount)
    {
        if (doneCount <= 0 || totalCount <= 0 || doneCount >= totalCount) return "";
        var elapsed = DateTime.UtcNow - startUtc;
        if (elapsed.TotalSeconds < 0.5) return "";
        var avg = elapsed.TotalSeconds / doneCount;
        var remaining = (totalCount - doneCount) * avg;
        if (remaining < 1)     return "";
        if (remaining < 60)    return $" · zbývá ~{Math.Ceiling(remaining):0} s";
        if (remaining < 3600)  return $" · zbývá ~{Math.Ceiling(remaining / 60):0} min";
        return $" · zbývá ~{remaining / 3600:F1} h";
    }

    /// <summary>
    /// Aktualizuje status bar dole + velký banner nahoře (pokud běží busy).
    /// Volat namísto přímého _status.Text = ...
    /// </summary>
    private void UpdateStatus(string text, string? detail = null)
    {
        _status.Text = text;
        _busyTitle.Text = "⏳ " + text;
        if (detail != null) _busyDetail.Text = detail;
        _status.Refresh();
        _busyTitle.Refresh();
        _busyDetail.Refresh();
    }

    private void OnAddFile()
    {
        var exts = _settings.ImportExtensions ?? new List<string> { "sldprt", "sldasm", "slddrw" };
        var pattern = string.Join(";", exts.Select(e => "*." + e.TrimStart('.').ToLowerInvariant()));
        using var dlg = new OpenFileDialog
        {
            Multiselect = true,
            Filter = $"CAD soubory|{pattern}|Všechny|*.*",
            InitialDirectory = _settings.DefaultCadFolder ?? "",
        };
        if (dlg.ShowDialog(this) != DialogResult.OK) return;
        int added = 0;
        foreach (var f in dlg.FileNames) { if (AddFilePathIfNew(f) != null) added++; }

        // Auto — pokud přibyl aspoň jeden SW soubor, rovnou spustit Vyhledat
        // komponenty. Předchází situaci, kdy uživatel přidá .sldprt, hned klikne
        // Odevzdat a Bridge nestihne načíst přílohy / feature-hash.
        if (added > 0 && _rows.Any(r => SwNativeExts.Contains(r.Extension)))
        {
            _ = OnSearchAsync();
        }
    }

    private void HandleIncomingPath(string? path)
    {
        if (string.IsNullOrEmpty(path)) return;
        if (!File.Exists(path)) return;
        AddFilePath(path);
    }

    private void AddFilePath(string path) => AddFilePathIfNew(path);

    /// <summary>Přidá soubor do gridu, pokud stejná cesta ještě není v seznamu.
    /// Vrací nově přidaný FileRow, nebo null pokud už existoval.</summary>
    private FileRow? AddFilePathIfNew(string path)
    {
        var norm = Path.GetFullPath(path);
        if (_rows.Any(r => string.Equals(Path.GetFullPath(r.Path), norm, StringComparison.OrdinalIgnoreCase)))
            return null;

        var ext = Path.GetExtension(path).ToLowerInvariant().TrimStart('.');
        var row = new FileRow
        {
            Path = path,
            FileName = Path.GetFileName(path),
            Extension = ext,
            Quantity = 1,
            Status = "Čeká",
        };
        _rows.Add(row);
        _filesGrid.Rows.Add(row.FileName, row.Extension, row.ConfigurationName ?? "—",
            row.Quantity, row.ComponentCount, row.Status);
        return row;
    }

    /// <summary>
    /// Porovná lokální stav každého primárního souboru se stavem na serveru.
    /// Preferuje feature_hash (SHA-256 feature-tree SW) před SHA-256 binárky, protože
    /// SolidWorks mění obsah souboru i při pouhém Save (časové razítko), takže
    /// checksum není spolehlivý indikátor reálné změny geometrie/konstrukce.
    /// Řádky označí stavem: ⚡ Nový / ⚡ Změněný / ✓ Beze změn.
    /// </summary>
    private async Task DetectChangesAsync()
    {
        if (_selectedProjectId == null || _rows.Count == 0) return;
        try
        {
            UpdateStatus("Porovnávám se serverem…", "Kontroluji hash existujících výkresů v HolyOSu");
            var serverHashes = await _client.GetExistingHashesAsync(_selectedProjectId.Value);

            for (int i = 0; i < _rows.Count; i++)
            {
                var row = _rows[i];
                // Spočítat lokální checksum (cache-náchylná operace — dělá to až teď,
                // takže velké soubory trvají vteřinu, menší ms).
                row.LocalChecksum ??= await Task.Run(() => ComputeSha256(row.Path));

                string state;
                string statusText;

                if (!serverHashes.TryGetValue(row.FileName, out var sh))
                {
                    state = "new";
                    statusText = "⚡ Nový";
                }
                else
                {
                    // Primárně porovnej feature-hash (hash feature-tree). Pokud některý
                    // chybí (starší server, jiný SW soubor), padáme zpět na SHA-256.
                    bool? featureEqual = (row.FeatureHash != null && sh.FeatureHash != null)
                        ? string.Equals(row.FeatureHash, sh.FeatureHash, StringComparison.OrdinalIgnoreCase)
                        : (bool?)null;
                    bool? checksumEqual = (row.LocalChecksum != null && sh.Checksum != null)
                        ? string.Equals(row.LocalChecksum, sh.Checksum, StringComparison.OrdinalIgnoreCase)
                        : (bool?)null;

                    if (featureEqual == true)
                    {
                        state = "same"; statusText = "✓ Beze změn";
                    }
                    else if (featureEqual == false)
                    {
                        state = "changed"; statusText = "⚡ Změněný";
                    }
                    else if (checksumEqual == true)
                    {
                        state = "same"; statusText = "✓ Beze změn";
                    }
                    else if (checksumEqual == false)
                    {
                        state = "changed"; statusText = "⚡ Změněný";
                    }
                    else
                    {
                        // Server nemá ani jeden hash → bereme jako změnu (první upload s hashem).
                        state = "changed"; statusText = "⚡ Změněný";
                    }
                }
                row.ChangeState = state;

                // Do "Stav" sloupce dáme prefix dle diff proti serveru + dřívější info.
                var baseStatus = row.IsVirtualAssembly ? "Virtuální (vynechá se)"
                    : !SwNativeExts.Contains(row.Extension) ? "Připraveno (raw)"
                    : "Připraveno";
                _filesGrid.Rows[i].Cells["Status"].Value = $"{statusText}  ·  {baseStatus}";

                // Zvýraznění celého řádku
                var gridRow = _filesGrid.Rows[i];
                if (state == "new")
                {
                    gridRow.DefaultCellStyle.ForeColor = Color.FromArgb(34, 197, 94);   // zelená
                    gridRow.DefaultCellStyle.Font = new Font(_filesGrid.Font, FontStyle.Bold);
                }
                else if (state == "changed")
                {
                    gridRow.DefaultCellStyle.ForeColor = Color.FromArgb(234, 179, 8);   // žlutá
                    gridRow.DefaultCellStyle.Font = new Font(_filesGrid.Font, FontStyle.Bold);
                }
                else if (state == "same")
                {
                    gridRow.DefaultCellStyle.ForeColor = Color.FromArgb(107, 114, 128); // šedá
                }
            }

            var news    = _rows.Count(r => r.ChangeState == "new");
            var changed = _rows.Count(r => r.ChangeState == "changed");
            var same    = _rows.Count(r => r.ChangeState == "same");
            _status.ForeColor = Color.FromArgb(22, 163, 74);
            _status.Text = $"Porovnáno se serverem: ⚡ {news} nových, ⚡ {changed} změněných, ✓ {same} beze změn";
        }
        catch (Exception ex)
        {
            Diagnostics.LogException("DetectChangesAsync", ex);
        }
    }

    /// <summary>
    /// Spočítá SHA-256 hex souboru. Server ho použije k detekci změn mezi uploady.
    /// </summary>
    private static string? ComputeSha256(string path)
    {
        try
        {
            if (!File.Exists(path)) return null;
            using var sha = System.Security.Cryptography.SHA256.Create();
            using var fs = File.OpenRead(path);
            var hash = sha.ComputeHash(fs);
            var sb = new System.Text.StringBuilder(hash.Length * 2);
            foreach (var b in hash) sb.Append(b.ToString("x2"));
            return sb.ToString();
        }
        catch { return null; }
    }

    /// <summary>
    /// Pozná virtuální sestavu podle custom property Typ = "virtualni".
    /// Hledá case-insensitive přes klíče "Typ" / "typ" / "TYP" a porovnává hodnotu.
    /// </summary>
    private static bool IsVirtualAssemblyByProps(Dictionary<string, object?>? props)
    {
        if (props == null) return false;
        foreach (var kv in props)
        {
            if (!string.Equals(kv.Key, "Typ", StringComparison.OrdinalIgnoreCase)) continue;
            var v = (kv.Value ?? "").ToString()?.Trim();
            if (string.Equals(v, "virtualni", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(v, "virtuální", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(v, "virtual",   StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }
        }
        return false;
    }

    /// <summary>Detekuje, zda je CAD soubor součástí SolidWorks Toolboxu
    /// nebo běžné knihovny normalizovaných dílů (ISO šrouby, matky…).</summary>
    private static bool IsToolboxPart(string path)
    {
        var p = path.ToLowerInvariant();
        return p.Contains("toolbox")
            || p.Contains("normalizované")
            || p.Contains("normalizovane")
            || p.Contains("\\iso ")
            || p.Contains("\\din ")
            || p.Contains("\\ansi ");
    }

    private void ProcessPendingQueue()
    {
        int before = _rows.Count;
        while (AppState.TryDequeuePath(out var p)) HandleIncomingPath(p);
        BringToFront();

        // Nové SW soubory → auto Vyhledat komponenty (pokud zrovna neběží).
        if (_rows.Count > before
            && _btnSearch.Enabled
            && _rows.Any(r => SwNativeExts.Contains(r.Extension)))
        {
            _ = OnSearchAsync();
        }
    }

    // ── Vyhledat komponenty přes SW (klíčová funkce z popisu uživatele) ─────
    private async Task OnSearchAsync()
    {
        if (_rows.Count == 0)
        {
            MessageBox.Show(this, "Nejdřív přidej nějaký soubor.", "HolyOS",
                MessageBoxButtons.OK, MessageBoxIcon.Information);
            return;
        }

        SetBusy(true);
        _status.ForeColor = Color.FromArgb(100, 116, 139);
        UpdateStatus("Spouštím SolidWorks…", "Chvilku to trvá, pokud SW běží poprvé.");
        _excludedComponents.Clear();
        try
        {
            await Task.Run(() => _sw.Connect());

            int processed = 0, addedComponents = 0, virtualCount = 0, failed = 0;
            int idx = 0;
            var swStartUtc = DateTime.UtcNow;
            while (idx < _rows.Count)
            {
                var row = _rows[idx];
                if (SwNativeExts.Contains(row.Extension))
                {
                    // Počet SW řádků pro ETA — používám aktuální celkový počet,
                    // i když auto-expanze přidává během chodu. Odhad se průběžně
                    // upravuje podle reálné rychlosti.
                    var swTotal = _rows.Count(r => SwNativeExts.Contains(r.Extension));
                    var eta = FormatEta(swStartUtc, processed, swTotal);
                    UpdateStatus(
                        $"Vyhledávám komponenty — {idx + 1}/{_rows.Count}{eta}",
                        $"Čtu: {row.FileName}");
                    // ProcessRow má vlastní try/catch — exception z něj nepropadne
                    // a loop pokračuje dál. Ale pro jistotu obalujeme ještě my,
                    // kdyby ProcessRow vyhodil něco mimo svůj catch.
                    try
                    {
                        await Task.Run(() => ProcessRow(row));
                    }
                    catch (Exception rowEx)
                    {
                        failed++;
                        row.Status = "Chyba: " + Diagnostics.ShortMessage(rowEx);
                        Diagnostics.LogException($"OnSearchAsync row {row.FileName}", rowEx);
                    }

                    _filesGrid.Rows[idx].Cells["Cfg"].Value       = row.ConfigurationName ?? "—";
                    _filesGrid.Rows[idx].Cells["CompCount"].Value = row.ComponentCount;
                    _filesGrid.Rows[idx].Cells["Status"].Value    = row.Status;
                    if (row.IsVirtualAssembly)
                    {
                        _filesGrid.Rows[idx].DefaultCellStyle.ForeColor = Color.FromArgb(107, 114, 128);
                        _filesGrid.Rows[idx].DefaultCellStyle.Font = new Font(_filesGrid.Font, FontStyle.Italic);
                    }
                    processed++;

                    // Auto-expand — pro každou komponentu, pokud je její fyzický soubor
                    // na disku a není z Toolboxu, přidej ji jako další řádek (rekurzivně
                    // — další iterace cyklu ji pak zase zpracuje a rozbalí subsestavu).
                    // Komponenty bez fyzického souboru (Path prázdná nebo File neexistuje)
                    // jsou "fiktivní" (virtual components v SW) — pouze se napočítají pro
                    // informaci a zachovají se v kusovníku, ale nestahují se samostatně.
                    if (_settings.SubmitComponents)
                    {
                        foreach (var c in row.Components)
                        {
                            // Potlačené komponenty (Suppressed) chceme VIDĚT v gridu modře,
                            // ale nikdy neposlat do HolyOSu. Přidáme řádek, označíme ho
                            // vizuálně a filtrujeme při submit.
                            if (c.IsSuppressed)
                            {
                                _excludedComponents.Add((c.Name, "Potlačená (Suppressed)", row.FileName));
                                if (!string.IsNullOrWhiteSpace(c.Path) && File.Exists(c.Path))
                                {
                                    var supRow = AddFilePathIfNew(c.Path);
                                    if (supRow != null)
                                    {
                                        supRow.IsSuppressed = true;
                                        supRow.Status = "Potlačená (vynechá se)";
                                        // Najdi právě přidaný řádek a obarvi modře
                                        for (int gi = _filesGrid.Rows.Count - 1; gi >= 0; gi--)
                                        {
                                            if ((string?)_filesGrid.Rows[gi].Cells["File"].Value == supRow.FileName)
                                            {
                                                _filesGrid.Rows[gi].DefaultCellStyle.ForeColor = Color.FromArgb(37, 99, 235);
                                                _filesGrid.Rows[gi].DefaultCellStyle.Font = new Font(_filesGrid.Font, FontStyle.Italic);
                                                _filesGrid.Rows[gi].Cells["Status"].Value = supRow.Status;
                                                break;
                                            }
                                        }
                                    }
                                }
                                continue;
                            }
                            if (c.ExcludeFromBom)
                            {
                                _excludedComponents.Add((c.Name, "Vyloučená z kusovníku (ExcludeFromBOM)", row.FileName));
                                continue;
                            }
                            if (string.IsNullOrWhiteSpace(c.Path) || !File.Exists(c.Path))
                            {
                                virtualCount++;
                                _excludedComponents.Add((c.Name, "Bez fyzického souboru (virtuální)", row.FileName));
                                continue;
                            }
                            if (_settings.IgnoreToolboxParts && IsToolboxPart(c.Path))
                            {
                                _excludedComponents.Add((c.Name, "Standardní díl (Toolbox/ISO/normalizované)", row.FileName));
                                continue;
                            }
                            if (AddFilePathIfNew(c.Path) != null) addedComponents++;
                        }
                    }
                }
                idx++;
            }

            _status.ForeColor = failed > 0 ? Color.FromArgb(234, 88, 12) : Color.FromArgb(22, 163, 74);
            _status.Text = $"Hotovo — {processed} zpracováno, {addedComponents} přidaných komponent, "
                         + $"{virtualCount} fiktivních"
                         + (_excludedComponents.Count > 0 ? $", {_excludedComponents.Count} vyloučených" : "")
                         + (failed > 0 ? $", {failed} chyb (koukni na Stav sloupec)" : "");
            RenderSelectedComponents();

            // Porovnat se serverem a označit změněné soubory ⚡.
            await DetectChangesAsync();

            // Přehled vyloučených komponent — co a proč Bridge neposlal do HolyOSu.
            ShowExcludedSummary();
        }
        catch (Exception ex)
        {
            _status.ForeColor = Color.FromArgb(220, 38, 38);
            _status.Text = "Chyba: " + Diagnostics.ShortMessage(ex);
            Diagnostics.LogException("OnSearchAsync", ex);
        }
        finally
        {
            SetBusy(false);
        }
    }

    /// <summary>
    /// Zobrazí přehled komponent, které Bridge vyloučil z exportu, seskupené
    /// podle pravidla vyloučení. Uživatel tak vidí, proč některé díly v HolyOSu
    /// nebudou (potlačená, ExcludeFromBOM, Toolbox, bez souboru). Zobrazuje se
    /// v neblokujícím modelu — Form, ne MessageBox, kvůli velkému obsahu.
    /// </summary>
    private void ShowExcludedSummary()
    {
        if (_excludedComponents.Count == 0) return;

        // Seskupení podle důvodu, řazené od nejčastějšího.
        var groups = _excludedComponents
            .GroupBy(x => x.Reason)
            .OrderByDescending(g => g.Count())
            .ToList();

        var sb = new System.Text.StringBuilder();
        sb.AppendLine($"Celkem vyloučeno: {_excludedComponents.Count} komponent");
        sb.AppendLine("Pravidla vyloučení z exportu do HolyOSu:");
        sb.AppendLine();
        foreach (var g in groups)
        {
            sb.AppendLine($"• {g.Key} — {g.Count()}×");
        }
        sb.AppendLine();
        sb.AppendLine("DETAILY:");
        foreach (var g in groups)
        {
            sb.AppendLine();
            sb.AppendLine($"══ {g.Key} ({g.Count()}×) ══");
            foreach (var (name, _, parent) in g.Take(200))
            {
                sb.AppendLine($"   {name}  (v sestavě: {parent})");
            }
            if (g.Count() > 200) sb.AppendLine($"   … a dalších {g.Count() - 200}");
        }

        // Modální Form s TextBox (ReadOnly, monospace, scrollbar) — lepší než
        // MessageBox, který text hyzdí a nejde z něj kopírovat.
        using var dlg = new Form
        {
            Text = "Vyloučené komponenty — pravidla exportu",
            StartPosition = FormStartPosition.CenterParent,
            Size = new Size(760, 580),
            MinimumSize = new Size(520, 360),
            Font = new Font("Segoe UI", 9.5f),
            ShowIcon = false,
            MaximizeBox = true,
            MinimizeBox = false,
        };
        var layout = new TableLayoutPanel
        {
            Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 2,
            Padding = new Padding(12),
        };
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 44));

        var txt = new TextBox
        {
            Multiline = true,
            ReadOnly = true,
            ScrollBars = ScrollBars.Both,
            Dock = DockStyle.Fill,
            Font = new Font("Consolas", 9.5f),
            WordWrap = false,
            Text = sb.ToString(),
            BackColor = Color.FromArgb(248, 250, 252),
        };
        layout.Controls.Add(txt, 0, 0);

        var btnRow = new FlowLayoutPanel
        {
            Dock = DockStyle.Fill,
            FlowDirection = FlowDirection.RightToLeft,
        };
        var btnOk = new Button
        {
            Text = "Zavřít", Width = 110, Height = 32,
            DialogResult = DialogResult.OK,
            BackColor = Color.FromArgb(2, 132, 199),
            ForeColor = Color.White,
            FlatStyle = FlatStyle.Flat,
        };
        btnOk.FlatAppearance.BorderSize = 0;
        var btnCopy = new Button
        {
            Text = "Kopírovat", Width = 110, Height = 32,
            FlatStyle = FlatStyle.Flat,
            BackColor = Color.White,
            Margin = new Padding(0, 0, 8, 0),
        };
        btnCopy.FlatAppearance.BorderColor = Color.FromArgb(209, 213, 219);
        btnCopy.Click += (_, __) =>
        {
            try { Clipboard.SetText(txt.Text); } catch { }
        };
        btnRow.Controls.Add(btnOk);
        btnRow.Controls.Add(btnCopy);
        layout.Controls.Add(btnRow, 0, 1);
        dlg.Controls.Add(layout);
        dlg.AcceptButton = btnOk;

        dlg.ShowDialog(this);
    }

    /// <summary>
    /// Projde kořenový adresář (z Nastavení), najde primární CAD soubory
    /// (.sldprt/.sldasm/.slddrw/.step…) a ke každému připojí sesterské soubory
    /// se stejným základním názvem jako přílohy (PDF, DXF, DWG, STL, …).
    /// Nespouští SolidWorks — celý sken běží čistě nad filesystémem.
    /// </summary>
    private void OnScanFolder()
    {
        var root = _settings.DefaultCadFolder;
        if (string.IsNullOrWhiteSpace(root) || !Directory.Exists(root))
        {
            using var dlg = new FolderBrowserDialog
            {
                Description = "Vyber kořenovou složku s CAD soubory",
                InitialDirectory = root ?? "",
            };
            if (dlg.ShowDialog(this) != DialogResult.OK) return;
            root = dlg.SelectedPath;
            _settings.DefaultCadFolder = root;
            try { SettingsStore.Save(_settings); } catch { }
        }

        // Zablokovat UI během skenu + následně spuštěného Vyhledat komponenty,
        // aby uživatel nemohl klepnout Odevzdat dřív, než je všechno načteno.
        SetBusy(true);

        // PRIMARY je VŽDY jen SW model (SLDPRT/SLDASM), nezávisle na Settings.
        // Dříve brala logika primary ze _settings.PrimaryExtensions, takže pokud
        // tam uživatel přidal dxf/pdf/step, Bridge tyto přípony považoval za
        // primární výkres a SLDPRT se stával přílohou DXF souboru — kolize
        // s DB schématem, attachments se nezapisovaly.
        var primary = new HashSet<string>(new[] { "sldprt", "sldasm" }, StringComparer.OrdinalIgnoreCase);
        // Attachment přípony: unie AttachmentExtensions + všechny ne-primární
        // přípony z Settings (ať se neztratí, když si uživatel přidá vlastní typ).
        var attachExts = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var e in (_settings.AttachmentExtensions ?? new List<string>()))
            attachExts.Add(e.TrimStart('.').ToLowerInvariant());
        foreach (var e in (_settings.PrimaryExtensions ?? new List<string>()))
        {
            var norm = e.TrimStart('.').ToLowerInvariant();
            if (!primary.Contains(norm)) attachExts.Add(norm);
        }

        var searchOpt = _settings.ScanSubdirectories
            ? SearchOption.AllDirectories : SearchOption.TopDirectoryOnly;

        UpdateStatus("Skenuji složku…", root);
        _rows.Clear();
        _filesGrid.Rows.Clear();

        try
        {
            // Index všech souborů podle základního jména (bez přípony).
            var byBase = new Dictionary<string, List<string>>(StringComparer.OrdinalIgnoreCase);
            foreach (var path in Directory.EnumerateFiles(root, "*.*", searchOpt))
            {
                var baseName = Path.GetFileNameWithoutExtension(path);
                if (!byBase.TryGetValue(baseName, out var list))
                {
                    list = new List<string>();
                    byBase[baseName] = list;
                }
                list.Add(path);
            }

            // Pro každou skupinu souborů se stejným základním jménem najdi primární
            // a zbytek připoj jako přílohy. U skupin bez primárního souboru (orphan)
            // každý povolený soubor zařadíme jako samostatný raw řádek — typicky
            // samostatné DXF / STEP / DWG / PDF v kořenové složce, které nemají
            // odpovídající SW model.
            int primaryCount = 0, attachCount = 0, rawCount = 0;
            foreach (var (baseName, files) in byBase)
            {
                var primaryFiles = files
                    .Where(p => primary.Contains(Path.GetExtension(p).TrimStart('.').ToLowerInvariant()))
                    .ToList();

                if (primaryFiles.Count == 0)
                {
                    // Orphan — v této skupině není SW primární soubor.
                    // Každý povolený příloha-soubor zařaď samostatně jako raw řádek.
                    var orphans = files
                        .Where(p => attachExts.Contains(Path.GetExtension(p).TrimStart('.').ToLowerInvariant()))
                        .ToList();

                    foreach (var orphan in orphans)
                    {
                        var rawRow = new FileRow
                        {
                            Path = orphan,
                            FileName = Path.GetFileName(orphan),
                            Extension = Path.GetExtension(orphan).TrimStart('.').ToLowerInvariant(),
                            ConfigurationName = "Výchozí",
                            Quantity = 1,
                            Components = new List<AssemblyComponent>(),
                            ComponentCount = 0,
                            SiblingAttachments = new List<string>(),
                            Status = "Připraveno (samostatný)",
                        };
                        _rows.Add(rawRow);
                        _filesGrid.Rows.Add(rawRow.FileName, rawRow.Extension, rawRow.ConfigurationName,
                            rawRow.Quantity, rawRow.ComponentCount, rawRow.Status);
                        rawCount++;
                    }
                    continue;
                }

                // Přílohy = všechny soubory skupiny kromě primárního, co je v attachExts.
                var attachments = files
                    .Where(p => !primaryFiles.Contains(p, StringComparer.OrdinalIgnoreCase))
                    .Where(p => attachExts.Contains(Path.GetExtension(p).TrimStart('.').ToLowerInvariant()))
                    .ToList();

                // Preferujeme sestavu (.sldasm), pak díl (.sldprt) — to je primární zdroj.
                var main = primaryFiles.FirstOrDefault(p =>
                    string.Equals(Path.GetExtension(p), ".sldasm", StringComparison.OrdinalIgnoreCase))
                    ?? primaryFiles.First();

                // Ostatní primární soubory (pokud by jich bylo víc) se stanou také přílohami.
                attachments.AddRange(primaryFiles.Where(p => p != main));

                var row = new FileRow
                {
                    Path = main,
                    FileName = Path.GetFileName(main),
                    Extension = Path.GetExtension(main).TrimStart('.').ToLowerInvariant(),
                    ConfigurationName = "Výchozí",
                    Quantity = 1,
                    Components = new List<AssemblyComponent>(),
                    ComponentCount = 0,
                    SiblingAttachments = attachments,
                    Status = attachments.Count > 0
                        ? $"Připraveno · {attachments.Count} příloh"
                        : "Připraveno",
                };
                _rows.Add(row);
                _filesGrid.Rows.Add(row.FileName, row.Extension, row.ConfigurationName,
                    row.Quantity, row.ComponentCount, row.Status);

                primaryCount++;
                attachCount += attachments.Count;
            }

            _status.ForeColor = Color.FromArgb(22, 163, 74);
            _status.Text = $"Naskenováno: {primaryCount} hlavních, {attachCount} příloh, {rawCount} samostatných";
            RenderSelectedComponents();

            // Rozpočet příloh + samostatných podle přípon pro výpis uživateli.
            var breakdown = _rows
                .SelectMany(r => r.SiblingAttachments.Concat(new[] { r.Path }))
                .GroupBy(p => Path.GetExtension(p).TrimStart('.').ToUpperInvariant())
                .OrderByDescending(g => g.Count())
                .Select(g => $"{g.Key}: {g.Count()}")
                .ToList();

            var totalRows = primaryCount + rawCount;
            MessageBox.Show(this,
                $"Složka: {root}\n\n" +
                $"Hlavních souborů (.sldprt / .sldasm): {primaryCount}\n" +
                $"Samostatných souborů (DXF, STEP, DWG, PDF…): {rawCount}\n" +
                $"Příloh vedle hlavních souborů: {attachCount}\n" +
                (breakdown.Count > 0 ? "  " + string.Join(", ", breakdown) : "") + "\n\n" +
                (totalRows == 0
                    ? "Ve složce nebyl nalezen žádný relevantní soubor. Zkontroluj přípony v Nastavení a cestu."
                    : "Teď se automaticky spustí Vyhledat komponenty — rozbalím sestavy přes SolidWorks a označím změny."),
                "Výsledek skenování",
                MessageBoxButtons.OK,
                totalRows > 0 ? MessageBoxIcon.Information : MessageBoxIcon.Warning);

            // Po skenu automaticky spustit Vyhledat komponenty — bez toho Bridge
            // neotevře sestavy v SW, nezíská feature-hash ani komponenty, a
            // často Petr zapomíná tento krok udělat. OnSearchAsync má uvnitř
            // taky DetectChangesAsync, takže změny proti serveru se označí.
            // Busy je přenesen — OnSearchAsync si sám SetBusy(true/false).
            if (totalRows > 0)
            {
                _ = OnSearchAsync();
            }
            else
            {
                // Jen sken neprodukoval řádky — spustíme aspoň porovnání.
                _ = DetectChangesAsync();
            }
        }
        catch (Exception ex)
        {
            Diagnostics.LogException("OnScanFolder", ex);
            _status.ForeColor = Color.FromArgb(220, 38, 38);
            _status.Text = "Chyba skenu: " + Diagnostics.ShortMessage(ex);
        }
        finally
        {
            // Synchronní část skenu skončila — odemknout UI. Pokud jsme spustili
            // OnSearchAsync, ten si busy depth rovnou zase zvedne.
            SetBusy(false);
        }
    }

    private static readonly HashSet<string> SwNativeExts = new(StringComparer.OrdinalIgnoreCase)
        { "sldprt", "sldasm", "slddrw" };

    private void ProcessRow(FileRow row)
    {
        // Ne-SolidWorks soubor (step, dxf, easm, eprt, iges, …) — RAW mód.
        // Nezkoušíme otvírat přes SW, protože komponenty ani custom props
        // z těchto formátů nedostaneme. Jen zaregistrujeme v gridu s defaultem.
        if (!SwNativeExts.Contains(row.Extension))
        {
            row.ConfigurationName = "Výchozí";
            row.CustomProperties  = new Dictionary<string, object?>();
            row.Components        = new List<AssemblyComponent>();
            row.ComponentCount    = 0;
            row.Status            = "Připraveno (raw)";
            return;
        }

        try
        {
            using var doc = _sw.OpenDocument(row.Path);
            var cfgs = doc.ConfigurationNames;
            row.ConfigurationName = cfgs.FirstOrDefault() ?? "Default";
            row.CustomProperties = doc.GetCustomProperties(row.ConfigurationName);
            row.Components = doc.GetComponents();
            row.ComponentCount = row.Components.Count;

            // Feature fingerprint — reálný indikátor změny geometrie.
            // Nezmění se při Save bez úprav (SW přepíše jen metadata), mění se jen
            // když konstruktér skutečně upravil strom featurek nebo přidal komponenty.
            row.FeatureHash = doc.FeatureFingerprint;

            // Virtuální sestava — custom property "Typ" (případně "typ") = "virtualni".
            // Takovou sestavu do HolyOSu neposíláme, ale expandujeme její komponenty.
            row.IsVirtualAssembly = IsVirtualAssemblyByProps(row.CustomProperties);

            // Auto-discovery sesterských příloh (.step, .dxf, …) vedle SW souboru.
            row.SiblingAttachments = FindSiblingAttachments(row.Path);

            row.Status = row.IsVirtualAssembly ? "Virtuální (vynechá se)" : "Připraveno";
        }
        catch (Exception ex)
        {
            row.Status = "Chyba: " + Diagnostics.ShortMessage(ex);
            Diagnostics.LogException($"ProcessRow — {row.FileName}", ex);
        }
    }

    /// <summary>
    /// Najde sesterské soubory vedle SW modelu — pro každou podporovanou
    /// přípontu (z nastavení + typické CAD exporty) vrátí existující cestu.
    /// </summary>
    private List<string> FindSiblingAttachments(string srcPath)
    {
        var result = new List<string>();
        try
        {
            var nameNoExt = Path.GetFileNameWithoutExtension(srcPath);
            if (string.IsNullOrEmpty(nameNoExt)) return result;

            // Seznam povolených příloh — AttachmentExtensions + non-SW z PrimaryExtensions
            // + hardcoded safety net standardních CAD exportů.
            var attachExts = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var e in (_settings.AttachmentExtensions ?? new List<string>()))
                attachExts.Add(e.TrimStart('.').ToLowerInvariant());
            foreach (var e in (_settings.PrimaryExtensions ?? new List<string>()))
            {
                var norm = e.TrimStart('.').ToLowerInvariant();
                if (!SwNativeExts.Contains(norm)) attachExts.Add(norm);
            }
            foreach (var e in new[] { "step", "stp", "dxf", "dwg", "iges", "igs", "easm", "eprt", "x_t", "x_b", "pdf", "stl" })
                attachExts.Add(e);

            // Kandidátní adresáře, kde siblings hledáme:
            //   1) vedle samotného souboru (standardní případ)
            //   2) v DefaultCadFolder (kořenová CAD složka) — konstruktéři často
            //      dávají DXF/PDF do jedné „společné" root složky, zatímco SLDPRT
            //      subsestav jsou ve vlastních podsložkách. Bez této cesty by
            //      Bridge nenašel siblings pro komponenty v podsložkách.
            var dirs = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var ownDir = Path.GetDirectoryName(srcPath);
            if (!string.IsNullOrEmpty(ownDir) && Directory.Exists(ownDir)) dirs.Add(ownDir);
            var root = _settings.DefaultCadFolder;
            if (!string.IsNullOrEmpty(root) && Directory.Exists(root)) dirs.Add(root);

            foreach (var dir in dirs)
            {
                IEnumerable<string> files;
                try { files = Directory.EnumerateFiles(dir, nameNoExt + ".*"); }
                catch { continue; }
                foreach (var file in files)
                {
                    if (!string.Equals(Path.GetFileNameWithoutExtension(file), nameNoExt,
                            StringComparison.OrdinalIgnoreCase))
                        continue;   // "NA0733kopie.SLDPRT" nesmí trefit "NA0733"
                    var ext = Path.GetExtension(file).TrimStart('.').ToLowerInvariant();
                    if (!attachExts.Contains(ext)) continue;
                    if (string.Equals(file, srcPath, StringComparison.OrdinalIgnoreCase)) continue;
                    if (!result.Any(x => string.Equals(x, file, StringComparison.OrdinalIgnoreCase)))
                        result.Add(file);
                }
            }
        }
        catch { /* best-effort */ }
        return result;
    }

    // ── Odevzdat do HolyOSu ─────────────────────────────────────────────────
    private async Task OnSubmitAsync()
    {
        if (_selectedProjectId == null)
        {
            MessageBox.Show(this, "Vyber projekt/blok vlevo.", "HolyOS",
                MessageBoxButtons.OK, MessageBoxIcon.Information);
            return;
        }
        if (_rows.Count == 0)
        {
            MessageBox.Show(this, "Žádné soubory k odevzdání.", "HolyOS",
                MessageBoxButtons.OK, MessageBoxIcon.Information);
            return;
        }

        // PHASE –1: Dialog pro váhu + poznámku u řádků s bleskem.
        // Zobrazí se jen pokud se předem detekovalo (_rows mají ChangeState)
        // aspoň u jednoho řádku "new" nebo "changed". Beze změny = nic neukázat.
        // Když uživatel klikne Zrušit, submit se přeruší.
        var changedRows = _rows.Where(r =>
            !r.IsVirtualAssembly &&
            (r.ChangeState == "new" || r.ChangeState == "changed"))
            .ToList();

        if (changedRows.Count > 0)
        {
            var entries = changedRows.Select(r => new ChangeDetailsForm.Entry(
                r.FileName, r.ChangeState, r.ChangeWeight, r.ChangeNote)).ToList();

            using var dlg = new ChangeDetailsForm(entries);
            if (dlg.ShowDialog(this) != DialogResult.OK)
            {
                _status.ForeColor = Color.FromArgb(100, 116, 139);
                _status.Text = "Odeslání zrušeno uživatelem.";
                return;
            }

            // Propiš hodnoty zpět do FileRow.
            for (int i = 0; i < changedRows.Count; i++)
            {
                changedRows[i].ChangeWeight = dlg.Result[i].Weight;
                changedRows[i].ChangeNote = dlg.Result[i].Note;
            }
        }

        SetBusy(true);

        // PHASE 0: uložit všechny otevřené "dirty" dokumenty v SolidWorksu.
        // Pokrývá scenario: uživatel upravuje díl ale ještě neklikl Save —
        // Bridge by jinak viděl starý obsah na disku a vyhodnotil jako "beze změn".
        // Bridge se připojuje k existující instanci SW (pokud neběží, spustí ji tichou),
        // takže se nezmění viditelnost uživatelského okna.
        if (_settings.RefreshAssembliesBeforeExport)
        {
            try
            {
                _status.ForeColor = Color.FromArgb(100, 116, 139);
                _status.Text = "Hledám neuložené změny v SolidWorksu…";
                _status.Refresh();
                await Task.Run(() => _sw.Connect());
                var savedDirty = await Task.Run(() => _sw.SaveDirtyOpenDocuments());
                if (savedDirty > 0)
                {
                    _status.Text = $"Uloženo {savedDirty} neuložených dokumentů v SW.";
                    _status.Refresh();
                }
            }
            catch (Exception ex)
            {
                Diagnostics.LogException("SaveDirtyBeforeExport", ex);
                // SW nemusí být dostupný — pokračujeme bez tohoto kroku.
            }
        }

        // PHASE 1: Obnova sestav — pro každou .sldasm otevřeme v SW a zavoláme Save.
        // Tím se promítnou změny v podsestavách/dílech do souboru vrcholové sestavy
        // (SW aktualizuje reference při uložení). Soubor na disku dostane aktuální
        // obsah a nový SHA-256 checksum, server správně zdetekuje change.
        if (_settings.RefreshAssembliesBeforeExport)
        {
            var assemblies = _rows.Where(r =>
                r.Extension.Equals("sldasm", StringComparison.OrdinalIgnoreCase) &&
                !r.IsVirtualAssembly &&
                File.Exists(r.Path)).ToList();
            if (assemblies.Count > 0)
            {
                _status.ForeColor = Color.FromArgb(100, 116, 139);
                _status.Text = $"Obnovuji {assemblies.Count} sestav v SolidWorks…";
                _status.Refresh();
                try
                {
                    await Task.Run(() => _sw.Connect());
                    for (int i = 0; i < assemblies.Count; i++)
                    {
                        var a = assemblies[i];
                        _status.Text = $"Aktualizuji sestavu v SW: {a.FileName} ({i + 1}/{assemblies.Count})";
                        _status.Refresh();
                        try
                        {
                            await Task.Run(() =>
                            {
                                using var doc = _sw.OpenDocument(a.Path);
                                doc.Save();
                            });
                        }
                        catch (Exception exRefresh)
                        {
                            Diagnostics.LogException($"RefreshAssembly {a.FileName}", exRefresh);
                        }
                    }
                }
                catch (Exception exConn)
                {
                    Diagnostics.LogException("RefreshAssembliesBeforeExport (SW Connect)", exConn);
                    // Pokud SW nedostupný, export pokračuje — jen bez refresh.
                }
            }
        }

        // Spočti celkový počet kroků pro progress bar:
        //   1 krok za každý ne-SW soubor (raw upload)
        //   + 1 krok za každou sesterskou přílohu (reálný počet po FindSiblingAttachments)
        //   + 1 krok za samotný SW soubor (pokud UploadSwFileItself=true)
        //   + 1 krok za finální /drawings-import
        // Vylučujeme virtuální sestavy (Typ=virtualni) a potlačené komponenty
        // (IsSuppressed=true). Obojí je v gridu vidět, ale do HolyOSu nejde.
        var rowsToUpload = _rows.Where(r => !r.IsVirtualAssembly && !r.IsSuppressed).ToList();

        // REKURZIVNÍ INDEX sourozenců napříč celým DefaultCadFolder — jednorázově
        // projde všechny podsložky a grupuje soubory podle base-name. Fixuje
        // problém, kdy primární SLDPRT je v podsložce (ref. ze sestavy), ale
        // jeho DXF/PDF sibling je v root (nebo v jiné sourozenecké složce).
        // Bez tohohto by FindSiblingAttachments (= vedle souboru + v root)
        // sourozence v mezisložkách neviděl.
        UpdateStatus("Indexuji sourozence v CAD složce…", _settings.DefaultCadFolder ?? "");
        var siblingIndex = new Dictionary<string, List<string>>(StringComparer.OrdinalIgnoreCase);
        try
        {
            if (!string.IsNullOrEmpty(_settings.DefaultCadFolder) && Directory.Exists(_settings.DefaultCadFolder))
            {
                var option = _settings.ScanSubdirectories
                    ? SearchOption.AllDirectories
                    : SearchOption.TopDirectoryOnly;
                await Task.Run(() =>
                {
                    foreach (var f in Directory.EnumerateFiles(_settings.DefaultCadFolder, "*.*", option))
                    {
                        var bn = Path.GetFileNameWithoutExtension(f);
                        if (string.IsNullOrEmpty(bn)) continue;
                        if (!siblingIndex.TryGetValue(bn, out var lst))
                            siblingIndex[bn] = lst = new List<string>();
                        lst.Add(f);
                    }
                });
            }
        }
        catch (Exception exIdx)
        {
            Diagnostics.LogException("BuildSiblingIndex", exIdx);
        }

        // Povolené přípony pro přílohy (stejně jako FindSiblingAttachments).
        var attachExts = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var e in (_settings.AttachmentExtensions ?? new List<string>()))
            attachExts.Add(e.TrimStart('.').ToLowerInvariant());
        foreach (var e in (_settings.PrimaryExtensions ?? new List<string>()))
        {
            var norm = e.TrimStart('.').ToLowerInvariant();
            if (!SwNativeExts.Contains(norm)) attachExts.Add(norm);
        }
        foreach (var e in new[] { "step", "stp", "dxf", "dwg", "iges", "igs", "easm", "eprt", "x_t", "x_b", "pdf", "stl" })
            attachExts.Add(e);

        // Doplníme siblings pro každý row — jednak klasicky (FindSiblingAttachments
        // = vedle souboru + root), jednak z rekurzivního indexu (celá tree).
        foreach (var r in rowsToUpload)
        {
            if (!SwNativeExts.Contains(r.Extension)) continue;
            var existing = new HashSet<string>(r.SiblingAttachments, StringComparer.OrdinalIgnoreCase);
            void AddIfValid(string path)
            {
                if (existing.Contains(path)) return;
                if (string.Equals(path, r.Path, StringComparison.OrdinalIgnoreCase)) return;
                var ext = Path.GetExtension(path).TrimStart('.').ToLowerInvariant();
                if (!attachExts.Contains(ext)) return;
                r.SiblingAttachments.Add(path);
                existing.Add(path);
            }
            foreach (var fs in FindSiblingAttachments(r.Path)) AddIfValid(fs);
            var bn = Path.GetFileNameWithoutExtension(r.Path);
            if (!string.IsNullOrEmpty(bn) && siblingIndex.TryGetValue(bn, out var candidates))
            {
                foreach (var cand in candidates) AddIfValid(cand);
            }
        }

        int totalSteps = 1 + rowsToUpload.Sum(r =>
        {
            int rawStep = SwNativeExts.Contains(r.Extension) ? 0 : 1;
            int swSelfStep = (_settings.UploadSwFileItself && SwNativeExts.Contains(r.Extension) && File.Exists(r.Path)) ? 1 : 0;
            return rawStep + r.SiblingAttachments.Count + swSelfStep;
        });
        int completed = 0;

        _progress.Visible = true;
        _progress.Minimum = 0;
        _progress.Maximum = Math.Max(1, totalSteps);
        _progress.Value = 0;
        _status.ForeColor = Color.FromArgb(100, 116, 139);
        UpdateStatus($"Odevzdávám… 0 / {totalSteps}", "Nahrávám soubory a přílohy na server");

        var submitStartUtc = DateTime.UtcNow;

        void Step(string msg)
        {
            completed++;
            if (completed > _progress.Maximum) completed = _progress.Maximum;
            _progress.Value = completed;
            if (_busyProgress.Style != ProgressBarStyle.Continuous)
            {
                _busyProgress.Style   = ProgressBarStyle.Continuous;
                _busyProgress.Minimum = 0;
                _busyProgress.Maximum = Math.Max(1, totalSteps);
            }
            _busyProgress.Value = Math.Min(completed, _busyProgress.Maximum);
            var eta = FormatEta(submitStartUtc, completed, totalSteps);
            UpdateStatus($"Odevzdávám… {completed} / {totalSteps}{eta}", msg);
            _progress.Refresh();
            _busyProgress.Refresh();
        }

        try
        {
            // Bridge 2.x: žádné spouštění SolidWorksu při odevzdávání. Pracujeme
            // čistě se soubory, jak je najdeme ve složce. PDF / DXF / STEP atd.
            // jsou prostě přílohy.

            // Upload všech nalezených příloh (sesterské soubory stejného jména).
            var rowAttachments = new Dictionary<FileRow, List<AttachmentDto>>();
            foreach (var row in rowsToUpload)
            {
                var list = new List<AttachmentDto>();

                // Ne-SW soubor (raw mód) — přibalíme ho samotného jako přílohu (raw bytes).
                if (!SwNativeExts.Contains(row.Extension))
                {
                    try
                    {
                        var bytes = await Task.Run(() => File.ReadAllBytes(row.Path));
                        var uploaded = await _client.UploadAssetAsync(row.Extension,
                            row.FileName, bytes);
                        list.Add(new AttachmentDto
                        {
                            Kind = row.Extension,
                            Filename = row.FileName,
                            Path = uploaded.Path,
                        });
                    }
                    catch (Exception ex)
                    {
                        Diagnostics.LogException($"UploadRaw {row.FileName}", ex);
                    }
                    Step($"Nahráno: {row.FileName}");
                }

                // SAFETY NET: před upload vždycky re-scan siblings. Pokud byl row
                // přidán přes auto-expanzi (Vyhledat komponenty → AddFilePathIfNew),
                // SiblingAttachments nemusí být kompletní. Zde doplníme všechno,
                // co FindSiblingAttachments vidí (vedle souboru + v DefaultCadFolder).
                if (SwNativeExts.Contains(row.Extension))
                {
                    var freshSiblings = FindSiblingAttachments(row.Path);
                    var existingSet = new HashSet<string>(row.SiblingAttachments, StringComparer.OrdinalIgnoreCase);
                    foreach (var fs in freshSiblings)
                    {
                        if (!existingSet.Contains(fs))
                        {
                            row.SiblingAttachments.Add(fs);
                            existingSet.Add(fs);
                        }
                    }
                }

                // Sesterské soubory vedle SW modelu — nahrajeme jako přílohy.
                // Retry 3× při přechodných síťových chybách, ať nic nezapadne tiše.
                foreach (var sib in row.SiblingAttachments)
                {
                    if (!File.Exists(sib)) { Step($"Přeskakuji (neexistuje): {Path.GetFileName(sib)}"); continue; }
                    var kind = Path.GetExtension(sib).TrimStart('.').ToLowerInvariant();
                    var sibFileName = Path.GetFileName(sib);
                    Exception? lastEx = null;
                    bool uploaded = false;
                    for (int attempt = 1; attempt <= 3 && !uploaded; attempt++)
                    {
                        try
                        {
                            var bytes = await Task.Run(() => File.ReadAllBytes(sib));
                            var up = await _client.UploadAssetAsync(kind, sibFileName, bytes);
                            list.Add(new AttachmentDto { Kind = kind, Filename = sibFileName, Path = up.Path });
                            uploaded = true;
                        }
                        catch (Exception ex)
                        {
                            lastEx = ex;
                            if (attempt < 3) await Task.Delay(500 * attempt); // 500ms, 1000ms backoff
                        }
                    }
                    if (!uploaded && lastEx != null)
                        Diagnostics.LogException($"UploadSibling FAILED {sibFileName} (3 pokusy)", lastEx);
                    Step(uploaded
                        ? $"Nahráno: {sibFileName}"
                        : $"SELHALO: {sibFileName}");
                }

                // Samotný SW soubor (SLDPRT/SLDASM/SLDDRW) — uploadneme ho také
                // jako přílohu, aby šel v HolyOSu stáhnout a otevřít v eDrawings
                // nebo SolidWorks. Velké sestavy jsou desítky MB, ale při scan
                // Petrovy celé složky by to zahltilo úložiště — proto jen pokud
                // to uživatel v Nastavení zapnul (UploadSwFileItself, default ON
                // pro začátek, uživatel pak může vypnout).
                if (_settings.UploadSwFileItself
                    && SwNativeExts.Contains(row.Extension)
                    && File.Exists(row.Path))
                {
                    var kind = row.Extension.ToLowerInvariant();
                    Exception? lastEx = null;
                    bool uploaded = false;
                    for (int attempt = 1; attempt <= 3 && !uploaded; attempt++)
                    {
                        try
                        {
                            var bytes = await Task.Run(() => File.ReadAllBytes(row.Path));
                            var up = await _client.UploadAssetAsync(kind, row.FileName, bytes);
                            list.Add(new AttachmentDto { Kind = kind, Filename = row.FileName, Path = up.Path });
                            uploaded = true;
                        }
                        catch (Exception ex)
                        {
                            lastEx = ex;
                            if (attempt < 3) await Task.Delay(500 * attempt);
                        }
                    }
                    if (!uploaded && lastEx != null)
                        Diagnostics.LogException($"UploadSwFile FAILED {row.FileName} (3 pokusy)", lastEx);
                    Step(uploaded
                        ? $"Nahrán SW soubor: {row.FileName}"
                        : $"SELHALO (SW): {row.FileName}");
                }

                rowAttachments[row] = list;
            }

            _status.Text = $"Zapisuji metadata na server…  ·  {completed} / {totalSteps}";
            _status.Refresh();

            var payload = new DrawingsImportRequest
            {
                Project = new ProjectRef { Id = _selectedProjectId },
                GoodsBlockId = _selectedBlockId,
                Overwrite = _chkOverwrite.Checked,
                // Virtuální sestavy (custom property Typ=virtualni) vynecháváme z uploadu —
                // jejich komponenty se ale odevzdaly samostatně díky auto-expanzi.
                DrawingFiles = _rows.Where(r => !r.IsVirtualAssembly).Select(r => new DrawingFileDto
                {
                    Name = Path.GetFileNameWithoutExtension(r.FileName),
                    DrawingFileName = r.FileName,
                    RelativePath = null,
                    Extension = r.Extension,
                    Version = 1,
                    SourcePath = r.Path,
                    Checksum = r.LocalChecksum ?? ComputeSha256(r.Path),
                    FeatureHash = r.FeatureHash,
                    ChangeWeight = r.ChangeWeight,
                    ChangeNote = r.ChangeNote,
                    Configurations = new()
                    {
                        new ConfigurationDto
                        {
                            ConfigurationName = r.ConfigurationName ?? "Default",
                            Quantity = r.Quantity,
                            SelectedToSubmit = true,
                            CustomProperties = r.CustomProperties ?? new(),
                            PdfPath = r.PdfPath,
                            PngPath = r.PngPath,
                            StlPath = r.StlPath,
                            Attachments = rowAttachments.TryGetValue(r, out var al) ? al : new List<AttachmentDto>(),
                            // Do HolyOSu posíláme jen výrobně relevantní komponenty.
                            // Potlačené (Suppressed) a vyloučené z BOM (ExcludeFromBOM)
                            // se zcela vynechávají — v Bridge se jen zobrazí barevně
                            // pro vizuální kontrolu, ale na server jdou pouze "normální" díly.
                            Components = r.Components
                                .Where(c => !c.IsSuppressed && !c.ExcludeFromBom)
                                .Select(c => new ComponentDto
                                {
                                    Name = c.Name,
                                    Path = c.Path,
                                    Quantity = c.Quantity,
                                    ConfigurationName = c.Configuration,
                                    CustomProperties = c.CustomProperties,
                                }).ToList(),
                        }
                    }
                }).ToList()
            };

            var resp = await _client.ImportDrawingsAsync(payload);

            // Souhrn — co bylo vytvořeno / aktualizováno + rozpočet příloh.
            var totalAttachments = rowAttachments.Values.Sum(l => l.Count);
            var attachmentBreakdown = rowAttachments.Values
                .SelectMany(l => l)
                .GroupBy(a => (a.Kind ?? "").ToUpperInvariant())
                .OrderByDescending(g => g.Count())
                .Select(g => $"{g.Key}: {g.Count()}")
                .ToList();

            var lines = new List<string>
            {
                $"Hlavních souborů: {resp.Created.Count + resp.Updated.Count + resp.NotChanged.Count}",
                $"  • Nových: {resp.Created.Count}",
                $"  • Aktualizovaných: {resp.Updated.Count}",
                $"  • Beze změn: {resp.NotChanged.Count}",
                $"Příloh celkem: {totalAttachments}" + (attachmentBreakdown.Count > 0 ? "  (" + string.Join(", ", attachmentBreakdown) + ")" : ""),
            };
            if (resp.Created.Count > 0)
                lines.Add($"\nVytvořeno: {string.Join(", ", resp.Created.ConvertAll(x => x.DrawingFileName))}");
            if (resp.Updated.Count > 0)
                lines.Add($"Aktualizováno: {string.Join(", ", resp.Updated.ConvertAll(x => x.DrawingFileName))}");
            if (resp.NotChanged.Count > 0)
                lines.Add($"Beze změn: {string.Join(", ", resp.NotChanged.ConvertAll(x => x.DrawingFileName))}");
            if (resp.Errors.Count > 0)
                lines.Add("\nChyby: " + string.Join("; ", resp.Errors.ConvertAll(e => $"{e.File} – {e.Message}")));

            MessageBox.Show(this, string.Join("\n", lines),
                resp.Success ? "Odevzdání proběhlo úspěšně" : "Odevzdání částečně selhalo",
                MessageBoxButtons.OK,
                resp.Success ? MessageBoxIcon.Information : MessageBoxIcon.Warning);

            _status.Text = resp.Success ? "Odevzdáno" : "Dokončeno s chybami";
        }
        catch (Exception ex)
        {
            _status.ForeColor = Color.FromArgb(220, 38, 38);
            _status.Text = "Chyba: " + ex.Message;
            MessageBox.Show(this, ex.Message, "HolyOS",
                MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
        finally
        {
            SetBusy(false);
            _progress.Value = _progress.Maximum;
            // Po malé pauze progress bar schováme — aby uživatel viděl "dokončeno".
            var t = new System.Windows.Forms.Timer { Interval = 1500 };
            t.Tick += (_, __) => { _progress.Visible = false; t.Stop(); t.Dispose(); };
            t.Start();
        }
    }

    // Vrátí cestu k sesterskému .slddrw (výkres k modelu) nebo null, pokud neexistuje.
    // Zkouší se v těch stejné složce jako .sldprt/.sldasm a akceptuje obě velikosti
    // přípony (Windows souborový systém je case-insensitive, ale SolidWorks občas
    // vytváří soubory s velkou příponou SLDDRW).
    private static string? FindSiblingDrawing(string srcPath)
    {
        try
        {
            var dir = Path.GetDirectoryName(srcPath);
            if (string.IsNullOrEmpty(dir) || !Directory.Exists(dir)) return null;
            var nameNoExt = Path.GetFileNameWithoutExtension(srcPath);
            foreach (var ext in new[] { ".SLDDRW", ".slddrw" })
            {
                var p = Path.Combine(dir, nameNoExt + ext);
                if (File.Exists(p)) return p;
            }
            // Fallback: scan složky pro případ nesouladu v diakritice/case
            foreach (var p in Directory.EnumerateFiles(dir, nameNoExt + ".*"))
            {
                if (Path.GetExtension(p).Equals(".slddrw", StringComparison.OrdinalIgnoreCase))
                    return p;
            }
        }
        catch { /* best-effort */ }
        return null;
    }

    // Naplní spodní grid komponent podle aktuálně vybraného řádku v horním gridu.
    private void RenderSelectedComponents()
    {
        _componentsGrid.Rows.Clear();
        if (_filesGrid.SelectedRows.Count == 0 || _rows.Count == 0)
        {
            _componentsHeader.Text = "Komponenty vybrané sestavy";
            return;
        }
        var idx = _filesGrid.SelectedRows[0].Index;
        if (idx < 0 || idx >= _rows.Count) return;

        var row = _rows[idx];
        int virtualCount = 0, suppressedCount = 0, excludedCount = 0, virtualAsmCount = 0;

        // Index souborů v _rows podle cesty — pro rychlé vyhledání, zda je komponenta
        // zároveň v gridu (a zda je označená jako virtuální sestava).
        var byPath = _rows.Where(r => !string.IsNullOrEmpty(r.Path))
            .GroupBy(r => Path.GetFullPath(r.Path), StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.First(), StringComparer.OrdinalIgnoreCase);

        foreach (var c in row.Components)
        {
            var isFictional = string.IsNullOrWhiteSpace(c.Path) || !File.Exists(c.Path);
            if (isFictional) virtualCount++;
            if (c.IsSuppressed) suppressedCount++;
            if (c.ExcludeFromBom) excludedCount++;

            // Zjisti, zda je komponenta virtuální sestava (custom property Typ=virtualni).
            bool isVirtualAsm = false;
            if (!isFictional && c.Path != null &&
                byPath.TryGetValue(Path.GetFullPath(c.Path), out var matchedRow))
            {
                isVirtualAsm = matchedRow.IsVirtualAssembly;
            }
            if (isVirtualAsm) virtualAsmCount++;

            // Typ — kombinace stavů. Přednost mají stavy z SolidWorksu.
            string type;
            if (c.IsSuppressed)           type = "⛔ potlačený";
            else if (c.ExcludeFromBom)    type = "⊘ mimo BOM";
            else if (isFictional)         type = "🧩 fiktivní";
            else if (isVirtualAsm)        type = "⊙ virtuální";
            else if (c.Path?.EndsWith(".sldasm", StringComparison.OrdinalIgnoreCase) == true) type = "sestava";
            else                          type = "díl";

            var newRowIdx = _componentsGrid.Rows.Add(type, c.Name, c.Path ?? "—", c.Configuration ?? "—", c.Quantity);
            var r = _componentsGrid.Rows[newRowIdx];

            if (c.IsSuppressed)
            {
                r.DefaultCellStyle.ForeColor = Color.FromArgb(239, 68, 68); // červená
                r.DefaultCellStyle.Font = new Font(_componentsGrid.Font, FontStyle.Strikeout);
            }
            else if (c.ExcludeFromBom)
            {
                r.DefaultCellStyle.ForeColor = Color.FromArgb(245, 158, 11); // oranžová
            }
            else if (isVirtualAsm)
            {
                r.DefaultCellStyle.ForeColor = Color.FromArgb(168, 85, 247); // fialová
                r.DefaultCellStyle.Font = new Font(_componentsGrid.Font, FontStyle.Italic);
            }
            else if (isFictional)
            {
                r.DefaultCellStyle.ForeColor = Color.FromArgb(107, 114, 128);
                r.DefaultCellStyle.Font = new Font(_componentsGrid.Font, FontStyle.Italic);
            }
        }

        var tags = new List<string>();
        if (virtualCount > 0)    tags.Add($"{virtualCount} fiktivních");
        if (virtualAsmCount > 0) tags.Add($"{virtualAsmCount} virtuálních sestav");
        if (suppressedCount > 0) tags.Add($"{suppressedCount} potlačených");
        if (excludedCount > 0)   tags.Add($"{excludedCount} mimo BOM");

        _componentsHeader.Text = row.Components.Count == 0
            ? $"Komponenty: {row.FileName} — bez komponent (klikni Vyhledat komponenty)"
            : $"Komponenty: {row.FileName}  ·  {row.Components.Count} ks"
              + (tags.Count > 0 ? "  ·  " + string.Join(", ", tags) : "");
    }

    private sealed class FileRow
    {
        public string Path { get; set; } = "";
        public string FileName { get; set; } = "";
        public string Extension { get; set; } = "";
        public string? ConfigurationName { get; set; }
        public int Quantity { get; set; } = 1;
        public Dictionary<string, object?>? CustomProperties { get; set; }
        public List<AssemblyComponent> Components { get; set; } = new();
        public int ComponentCount { get; set; }
        public string? PdfPath { get; set; }
        public string? PngPath { get; set; }
        public string? StlPath { get; set; }
        /// <summary>Cesty k sesterským souborům (.step/.dxf/…) pro upload jako přílohy.</summary>
        public List<string> SiblingAttachments { get; set; } = new();
        /// <summary>Komponenta v nadřazené sestavě je potlačená (Suppressed). Do HolyOSu
        /// se neexportuje, v Bridge gridu je označena modrou barvou pro orientaci.</summary>
        public bool IsSuppressed { get; set; }

        /// <summary>Sestava má custom property "Typ" = "virtualni" → do HolyOSu se neexportuje,
        /// ale její komponenty ano.</summary>
        public bool IsVirtualAssembly { get; set; }

        /// <summary>Lokálně spočítaný SHA-256 primárního souboru.</summary>
        public string? LocalChecksum { get; set; }

        /// <summary>Hash featurek z SolidWorks modelu. Mění se jen při reálné úpravě
        /// geometrie, ne při pouhém Save. Preferován před LocalChecksum pro detekci změn.</summary>
        public string? FeatureHash { get; set; }

        /// <summary>Stav proti serveru: "new" (neexistuje), "changed" (checksum se liší),
        /// "same" (beze změn), "" (nezjišťováno).</summary>
        public string ChangeState { get; set; } = "";

        /// <summary>Váha změny, kterou konstruktér vybral v dialogu před odesláním.
        /// Povolené hodnoty: "minor" | "medium" | "major" | null (nevyplněno).</summary>
        public string? ChangeWeight { get; set; }

        /// <summary>Volitelná poznámka ke změně.</summary>
        public string? ChangeNote { get; set; }

        public string Status { get; set; } = "Čeká";
    }
}
