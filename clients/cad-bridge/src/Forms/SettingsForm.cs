// =============================================================================
// HolyOS CAD Bridge — Nastavení (Settings dialog)
//
// Otevírá se z hlavního okna (Submit) tlačítkem "⚙ Nastavení". Uživatel tu
// může měnit:
//   • přípony souborů, které Bridge akceptuje (OpenFileDialog filter
//     + shell kontextové menu)
//   • výchozí složku s CAD výkresy
//   • zda se má zkusit generovat chybějící PDF z modelů
//   • zda se mají přepisovat existující verze (výchozí stav checkboxu
//     v submit okně)
// =============================================================================

using System;
using System.Collections.Generic;
using System.Drawing;
using System.Linq;
using System.Windows.Forms;
using HolyOs.CadBridge.Transport;

namespace HolyOs.CadBridge.Forms;

public sealed class SettingsForm : Form
{
    private readonly BridgeSettings _settings;

    private readonly TextBox _txtServer = new() { Dock = DockStyle.Fill };
    private readonly DataGridView _gridExtensions = new();
    private readonly TextBox _txtFolder = new() { Dock = DockStyle.Fill };
    private readonly Button _btnBrowse = new() { Text = "Vybrat…", Width = 90 };
    private readonly CheckBox _chkGeneratePdf = new()
    {
        Text = "Zkusit generovat chybějící PDF pro výkresy",
        AutoSize = true,
    };
    private readonly CheckBox _chkOverwrite = new()
    {
        Text = "Ve výchozím stavu přepisovat stejné verze",
        AutoSize = true,
    };
    private readonly CheckBox _chkScanSubdirs = new()
    {
        Text = "Skenovat i podsložky (rekurzivně)",
        AutoSize = true,
    };
    private readonly CheckBox _chkSubmitComponents = new()
    {
        Text = "Po Vyhledat komponenty automaticky přidat díly/subsestavy (kompletní dokumentace)",
        AutoSize = true,
    };
    private readonly CheckBox _chkIgnoreToolbox = new()
    {
        Text = "Ignorovat standardní díly (Toolbox, ISO, normalizované)",
        AutoSize = true,
    };
    private readonly CheckBox _chkRefreshAssemblies = new()
    {
        Text = "Před exportem obnovit sestavy v SolidWorksu (promítne změny z podsestav)",
        AutoSize = true,
    };

    private readonly Button _btnSave   = new() { Text = "Uložit",  Width = 100, DialogResult = DialogResult.OK };
    private readonly Button _btnCancel = new() { Text = "Zrušit", Width = 100, DialogResult = DialogResult.Cancel };

    public SettingsForm(BridgeSettings settings)
    {
        _settings = settings;
        Text = "HolyOS CAD Bridge — Nastavení";
        StartPosition = FormStartPosition.CenterParent;
        Size = new Size(680, 640);
        MinimumSize = new Size(600, 580);
        Font = new Font("Segoe UI", 9.5f);
        FormBorderStyle = FormBorderStyle.Sizable;
        MaximizeBox = false;
        MinimizeBox = false;

        try
        {
            using var s = typeof(SettingsForm).Assembly.GetManifestResourceStream("app-icon.ico");
            if (s != null) Icon = new Icon(s);
        }
        catch { /* default ikonka */ }

        BuildUi();
        LoadValues();
        AcceptButton = _btnSave;
        CancelButton = _btnCancel;

        _btnSave.Click += (_, __) => SaveValues();
        _btnBrowse.Click += (_, __) =>
        {
            using var dlg = new FolderBrowserDialog
            {
                Description = "Vyber kořenovou složku s CAD výkresy",
                InitialDirectory = _txtFolder.Text,
            };
            if (dlg.ShowDialog(this) == DialogResult.OK)
                _txtFolder.Text = dlg.SelectedPath;
        };
    }

    private void BuildUi()
    {
        var layout = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            Padding = new Padding(16),
            ColumnCount = 2,
            RowCount = 8,
        };
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 180));
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 34));  // Server
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 26));  // popis přípon
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));  // grid přípon
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 44));  // default folder
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 30));  // chk pdf
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 30));  // chk overwrite
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 30));  // chk scan subdirs
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 30));  // chk submit components
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 30));  // chk ignore toolbox
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 30));  // chk refresh assemblies
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 10));  // spacer
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 48));  // buttons

        // Server
        layout.Controls.Add(MakeLabel("Server URL:"), 0, 0);
        layout.Controls.Add(_txtServer, 1, 0);

        // Popis přípon
        layout.Controls.Add(new Label
        {
            Text = "Přípony souborů, které Bridge akceptuje (bez tečky, malými písmeny):",
            AutoSize = false,
            Dock = DockStyle.Fill,
            TextAlign = ContentAlignment.BottomLeft,
            ForeColor = Color.FromArgb(75, 85, 99),
        }, 0, 1);
        layout.SetColumnSpan(layout.GetControlFromPosition(0, 1)!, 2);

        // Grid přípon
        _gridExtensions.Dock = DockStyle.Fill;
        _gridExtensions.RowHeadersVisible = false;
        _gridExtensions.AllowUserToAddRows = true;
        _gridExtensions.AllowUserToDeleteRows = true;
        _gridExtensions.AutoSizeColumnsMode = DataGridViewAutoSizeColumnsMode.Fill;
        _gridExtensions.Columns.Add(new DataGridViewTextBoxColumn
        {
            Name = "Extension",
            HeaderText = "Přípona (bez tečky)",
        });
        layout.Controls.Add(_gridExtensions, 0, 2);
        layout.SetColumnSpan(_gridExtensions, 2);

        // Default folder
        var folderRow = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            ColumnCount = 2,
            RowCount = 1,
        };
        folderRow.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        folderRow.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 100));
        folderRow.Controls.Add(_txtFolder, 0, 0);
        folderRow.Controls.Add(_btnBrowse, 1, 0);
        layout.Controls.Add(MakeLabel("Složka s výkresy:"), 0, 3);
        layout.Controls.Add(folderRow, 1, 3);

        // Checkboxy
        layout.Controls.Add(_chkGeneratePdf, 0, 4);
        layout.SetColumnSpan(_chkGeneratePdf, 2);
        layout.Controls.Add(_chkOverwrite, 0, 5);
        layout.SetColumnSpan(_chkOverwrite, 2);
        layout.Controls.Add(_chkScanSubdirs, 0, 6);
        layout.SetColumnSpan(_chkScanSubdirs, 2);
        layout.Controls.Add(_chkSubmitComponents, 0, 7);
        layout.SetColumnSpan(_chkSubmitComponents, 2);
        layout.Controls.Add(_chkIgnoreToolbox, 0, 8);
        layout.SetColumnSpan(_chkIgnoreToolbox, 2);
        layout.Controls.Add(_chkRefreshAssemblies, 0, 9);
        layout.SetColumnSpan(_chkRefreshAssemblies, 2);

        // Buttony
        var buttonRow = new FlowLayoutPanel
        {
            Dock = DockStyle.Fill,
            FlowDirection = FlowDirection.RightToLeft,
            Padding = new Padding(0, 8, 0, 0),
        };
        _btnSave.BackColor = Color.FromArgb(2, 132, 199);
        _btnSave.ForeColor = Color.White;
        _btnSave.FlatStyle = FlatStyle.Flat;
        _btnSave.FlatAppearance.BorderSize = 0;
        buttonRow.Controls.Add(_btnSave);
        buttonRow.Controls.Add(_btnCancel);
        layout.Controls.Add(buttonRow, 0, 11);
        layout.SetColumnSpan(buttonRow, 2);

        Controls.Add(layout);
    }

    private static Label MakeLabel(string text) => new()
    {
        Text = text,
        AutoSize = false,
        Dock = DockStyle.Fill,
        TextAlign = ContentAlignment.MiddleLeft,
    };

    private void LoadValues()
    {
        _txtServer.Text = _settings.ServerUrl;
        _txtFolder.Text = _settings.DefaultCadFolder ?? "";
        _chkGeneratePdf.Checked = _settings.GeneratePdfs;
        _chkOverwrite.Checked  = _settings.OverwriteSameVersion;
        _chkScanSubdirs.Checked     = _settings.ScanSubdirectories;
        _chkSubmitComponents.Checked = _settings.SubmitComponents;
        _chkIgnoreToolbox.Checked    = _settings.IgnoreToolboxParts;
        _chkRefreshAssemblies.Checked = _settings.RefreshAssembliesBeforeExport;

        _gridExtensions.Rows.Clear();
        foreach (var ext in _settings.ImportExtensions ?? new List<string>())
        {
            _gridExtensions.Rows.Add((ext ?? "").Trim().TrimStart('.').ToLowerInvariant());
        }
    }

    private void SaveValues()
    {
        _settings.ServerUrl            = _txtServer.Text.Trim();
        _settings.DefaultCadFolder     = string.IsNullOrWhiteSpace(_txtFolder.Text) ? null : _txtFolder.Text.Trim();
        _settings.GeneratePdfs         = _chkGeneratePdf.Checked;
        _settings.OverwriteSameVersion = _chkOverwrite.Checked;
        _settings.ScanSubdirectories   = _chkScanSubdirs.Checked;
        _settings.SubmitComponents     = _chkSubmitComponents.Checked;
        _settings.IgnoreToolboxParts   = _chkIgnoreToolbox.Checked;
        _settings.RefreshAssembliesBeforeExport = _chkRefreshAssemblies.Checked;

        var exts = new List<string>();
        foreach (DataGridViewRow row in _gridExtensions.Rows)
        {
            if (row.IsNewRow) continue;
            var v = (row.Cells["Extension"].Value as string)?.Trim().TrimStart('.').ToLowerInvariant();
            if (!string.IsNullOrEmpty(v) && !exts.Contains(v)) exts.Add(v);
        }
        if (exts.Count == 0) exts.AddRange(new[] { "sldprt", "sldasm", "slddrw" });
        _settings.ImportExtensions = exts;

        try
        {
            SettingsStore.Save(_settings);
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, "Nastavení se nepodařilo uložit: " + ex.Message,
                "HolyOS", MessageBoxButtons.OK, MessageBoxIcon.Error);
            DialogResult = DialogResult.None;
        }
    }
}
