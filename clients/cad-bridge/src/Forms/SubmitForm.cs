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
    private readonly Button _btnAddFile = new() { Text = "+ Přidat soubor…", Height = 32 };
    private readonly Button _btnSearch = new() { Text = "🔍 Vyhledat komponenty", Height = 32 };
    private readonly Button _btnSubmit = new() { Text = "✓ Odevzdat do HolyOSu", Height = 32 };
    private readonly CheckBox _chkOverwrite = new() { Text = "Přepsat stejné verze", AutoSize = true };
    private readonly Label _status = new() { AutoSize = false, Dock = DockStyle.Bottom, Height = 22,
        TextAlign = ContentAlignment.MiddleLeft, ForeColor = Color.FromArgb(100, 116, 139) };

    private readonly List<FileRow> _rows = new();
    private int? _selectedProjectId;
    private int? _selectedBlockId;

    public SubmitForm(HolyOsClient client, BridgeSettings settings)
    {
        _client = client;
        _settings = settings;

        Text = "HolyOS CAD Bridge";
        StartPosition = FormStartPosition.CenterScreen;
        Size = new Size(1100, 680);
        Font = new Font("Segoe UI", 9.5f);
        MinimumSize = new Size(900, 500);

        BuildUi();

        Shown += async (_, __) =>
        {
            await LoadProjectsAsync();
            HandleIncomingPath(AppState.PendingPath);
            AppState.PendingPath = null;
            AppState.PathEnqueued += () => BeginInvoke((Action)ProcessPendingQueue);
            AppState.FocusRequested += () => BeginInvoke((Action)BringToFront);
        };
        FormClosing += (_, __) => _sw.Dispose();

        _btnAddFile.Click += (_, __) => OnAddFile();
        _btnSearch.Click += async (_, __) => await OnSearchAsync();
        _btnSubmit.Click += async (_, __) => await OnSubmitAsync();

        _projectTree.AfterSelect += (_, __) =>
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
        };
    }

    private void BuildUi()
    {
        var split = new SplitContainer
        {
            Dock = DockStyle.Fill,
            SplitterDistance = 300,
        };

        // Levý panel — strom projektů
        _projectTree.Dock = DockStyle.Fill;
        _projectTree.HideSelection = false;
        split.Panel1.Controls.Add(_projectTree);

        var leftHeader = new Label
        {
            Text = "Projekty a bloky",
            Dock = DockStyle.Top,
            Height = 30,
            TextAlign = ContentAlignment.MiddleLeft,
            Font = new Font(Font, FontStyle.Bold),
            Padding = new Padding(10, 0, 0, 0),
        };
        split.Panel1.Controls.Add(leftHeader);
        leftHeader.BringToFront();

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
        _btnSearch.Width = 200;
        toolbar.Controls.AddRange(new Control[] { _btnAddFile, _btnSearch });
        rightLayout.Controls.Add(toolbar, 0, 0);

        _filesGrid.Dock = DockStyle.Fill;
        _filesGrid.AllowUserToAddRows = false;
        _filesGrid.SelectionMode = DataGridViewSelectionMode.FullRowSelect;
        _filesGrid.RowHeadersVisible = false;
        _filesGrid.AutoSizeColumnsMode = DataGridViewAutoSizeColumnsMode.Fill;
        _filesGrid.Columns.Add(new DataGridViewTextBoxColumn { Name = "File",     HeaderText = "Soubor", Width = 240 });
        _filesGrid.Columns.Add(new DataGridViewTextBoxColumn { Name = "Ext",      HeaderText = "Typ", Width = 60 });
        _filesGrid.Columns.Add(new DataGridViewTextBoxColumn { Name = "Cfg",      HeaderText = "Konfigurace", Width = 140 });
        _filesGrid.Columns.Add(new DataGridViewTextBoxColumn { Name = "Qty",      HeaderText = "Ks", Width = 60 });
        _filesGrid.Columns.Add(new DataGridViewTextBoxColumn { Name = "CompCount",HeaderText = "Komponent", Width = 100 });
        _filesGrid.Columns.Add(new DataGridViewTextBoxColumn { Name = "Status",   HeaderText = "Stav", Width = 120 });
        rightLayout.Controls.Add(_filesGrid, 0, 1);

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

        split.Panel2.Controls.Add(rightLayout);

        Controls.Add(split);
        Controls.Add(_status);
        _status.Text = "Připraveno";
    }

    // ── Načtení projektů do stromu ───────────────────────────────────────────
    private async Task LoadProjectsAsync()
    {
        _status.Text = "Načítám projekty…";
        try
        {
            var resp = await _client.GetProjectBlocksAsync();
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
            _status.Text = resp.Projects.Count == 0
                ? "Server nemá žádné projekty — nejdřív je založ v modulu CAD výkresy."
                : $"Načteno {resp.Projects.Count} projektů";
        }
        catch (Exception ex)
        {
            _status.ForeColor = Color.FromArgb(220, 38, 38);
            _status.Text = "Chyba: " + ex.Message;
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
    private void OnAddFile()
    {
        using var dlg = new OpenFileDialog
        {
            Multiselect = true,
            Filter = "SolidWorks|*.sldprt;*.sldasm;*.slddrw|Všechny|*.*",
        };
        if (dlg.ShowDialog(this) != DialogResult.OK) return;
        foreach (var f in dlg.FileNames) AddFilePath(f);
    }

    private void HandleIncomingPath(string? path)
    {
        if (string.IsNullOrEmpty(path)) return;
        if (!File.Exists(path)) return;
        AddFilePath(path);
    }

    private void AddFilePath(string path)
    {
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
    }

    private void ProcessPendingQueue()
    {
        while (AppState.TryDequeuePath(out var p)) HandleIncomingPath(p);
        BringToFront();
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

        _btnSearch.Enabled = false;
        _status.Text = "Spouštím SolidWorks…";
        try
        {
            await Task.Run(() => _sw.Connect());

            for (int i = 0; i < _rows.Count; i++)
            {
                var row = _rows[i];
                _status.Text = $"Zpracovávám {row.FileName}…";
                await Task.Run(() => ProcessRow(row));

                _filesGrid.Rows[i].Cells["Cfg"].Value       = row.ConfigurationName ?? "—";
                _filesGrid.Rows[i].Cells["CompCount"].Value = row.ComponentCount;
                _filesGrid.Rows[i].Cells["Status"].Value    = row.Status;
            }
            _status.Text = "Hotovo — komponenty načteny";
        }
        catch (Exception ex)
        {
            _status.ForeColor = Color.FromArgb(220, 38, 38);
            _status.Text = "Chyba: " + ex.Message;
        }
        finally
        {
            _btnSearch.Enabled = true;
        }
    }

    private void ProcessRow(FileRow row)
    {
        try
        {
            using var doc = _sw.OpenDocument(row.Path);
            var cfgs = doc.ConfigurationNames;
            row.ConfigurationName = cfgs.FirstOrDefault() ?? "Default";
            row.CustomProperties = doc.GetCustomProperties(row.ConfigurationName);
            row.Components = doc.GetComponents();
            row.ComponentCount = row.Components.Count;
            row.Status = "Připraveno";
        }
        catch (Exception ex)
        {
            row.Status = "Chyba: " + ex.Message;
        }
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

        _btnSubmit.Enabled = false;
        _status.Text = "Odevzdávám…";
        try
        {
            // Pre-upload PDF (volitelně)
            foreach (var row in _rows)
            {
                if (!_settings.GeneratePdfs) break;
                if (row.Extension != "slddrw") continue;
                if (row.PdfPath != null) continue;

                try
                {
                    using var doc = _sw.OpenDocument(row.Path);
                    var pdf = Exporters.ExportPdf(doc);
                    if (pdf != null)
                    {
                        var uploaded = await _client.UploadAssetAsync("pdf",
                            Path.GetFileNameWithoutExtension(row.FileName) + ".pdf", pdf);
                        row.PdfPath = uploaded.Path;
                    }
                }
                catch { /* PDF je best-effort */ }
            }

            var payload = new DrawingsImportRequest
            {
                Project = new ProjectRef { Id = _selectedProjectId },
                GoodsBlockId = _selectedBlockId,
                Overwrite = _chkOverwrite.Checked,
                DrawingFiles = _rows.Select(r => new DrawingFileDto
                {
                    Name = Path.GetFileNameWithoutExtension(r.FileName),
                    DrawingFileName = r.FileName,
                    RelativePath = null,
                    Extension = r.Extension,
                    Version = 1,
                    SourcePath = r.Path,
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
                            Components = r.Components.Select(c => new ComponentDto
                            {
                                Name = c.Name,
                                Path = c.Path,
                                Quantity = c.Quantity,
                                ConfigurationName = c.Configuration,
                            }).ToList(),
                        }
                    }
                }).ToList()
            };

            var resp = await _client.ImportDrawingsAsync(payload);
            var lines = new List<string>();
            if (resp.Created.Count > 0)
                lines.Add($"Vytvořeno: {string.Join(", ", resp.Created.ConvertAll(x => x.DrawingFileName))}");
            if (resp.Updated.Count > 0)
                lines.Add($"Aktualizováno: {string.Join(", ", resp.Updated.ConvertAll(x => x.DrawingFileName))}");
            if (resp.NotChanged.Count > 0)
                lines.Add($"Beze změn: {string.Join(", ", resp.NotChanged.ConvertAll(x => x.DrawingFileName))}");
            if (resp.UnknownComponents.Count > 0)
                lines.Add($"Nerozpoznané komponenty: {resp.UnknownComponents.Count}");
            if (resp.Errors.Count > 0)
                lines.Add("Chyby: " + string.Join("; ", resp.Errors.ConvertAll(e => $"{e.File} – {e.Message}")));

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
            _btnSubmit.Enabled = true;
        }
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
        public string Status { get; set; } = "Čeká";
    }
}
