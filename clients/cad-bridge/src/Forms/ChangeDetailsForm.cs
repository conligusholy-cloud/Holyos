// HolyOS CAD Bridge — dialog "Popis změn před odesláním"
// ================================================================
// Před odevzdáním do HolyOSu musí konstruktér u každého řádku
// označeného bleskem (⚡ Nový / ⚡ Změněný) vybrat váhu změny
// a volitelně připsat poznámku, co se změnilo.
// Po OK se hodnoty propíšou zpět do FileRow a submit flow pokračuje.
// Položky beze změn (ChangeState = "same") dialog nezobrazuje,
// protože se stejně neuploadují (server je reportuje jako not_changed).

using System;
using System.Collections.Generic;
using System.Drawing;
using System.Linq;
using System.Windows.Forms;

namespace HolyOs.CadBridge.Forms;

public sealed class ChangeDetailsForm : Form
{
    public sealed record Entry(
        string FileName,
        string ChangeState,       // "new" | "changed"
        string? InitialWeight,
        string? InitialNote)
    {
        public string? Weight { get; set; } = InitialWeight;
        public string? Note   { get; set; } = InitialNote;
    }

    private readonly List<Entry> _entries;
    private readonly DataGridView _grid;
    private readonly Button _btnOk;
    private readonly Button _btnCancel;

    public IReadOnlyList<Entry> Result => _entries;

    public ChangeDetailsForm(IEnumerable<Entry> entries)
    {
        _entries = entries.ToList();

        Text = "Popis změn před odesláním";
        Width = 980;
        Height = 560;
        MinimumSize = new Size(720, 420);
        StartPosition = FormStartPosition.CenterParent;
        MinimizeBox = false;
        MaximizeBox = false;
        FormBorderStyle = FormBorderStyle.Sizable;
        BackColor = Color.FromArgb(250, 250, 252);
        Font = new Font("Segoe UI", 9.0f);

        // ── Root layout: 3 řádky (hlavička, tabulka, patička) ───────────────
        var root = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            ColumnCount = 1,
            RowCount = 3,
            BackColor = Color.FromArgb(250, 250, 252),
        };
        root.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100f));
        root.RowStyles.Add(new RowStyle(SizeType.Absolute, 56f));    // header
        root.RowStyles.Add(new RowStyle(SizeType.Percent, 100f));    // grid
        root.RowStyles.Add(new RowStyle(SizeType.Absolute, 64f));    // footer
        Controls.Add(root);

        // ── Hlavička ────────────────────────────────────────────────────────
        var header = new Label
        {
            Dock = DockStyle.Fill,
            Padding = new Padding(18, 12, 18, 0),
            Text = "U každé položky vyber váhu změny (Drobná / Střední / Zásadní).\n"
                 + "Poznámka je volitelná, ale ocení ji kolega ve výrobě.",
            ForeColor = Color.FromArgb(55, 65, 81),
            TextAlign = ContentAlignment.TopLeft,
            AutoSize = false,
        };
        root.Controls.Add(header, 0, 0);

        // ── Grid ────────────────────────────────────────────────────────────
        _grid = new DataGridView
        {
            Dock = DockStyle.Fill,
            BackgroundColor = Color.White,
            BorderStyle = BorderStyle.FixedSingle,
            AllowUserToAddRows = false,
            AllowUserToDeleteRows = false,
            AllowUserToResizeRows = false,
            RowHeadersVisible = false,
            SelectionMode = DataGridViewSelectionMode.CellSelect,
            ColumnHeadersHeightSizeMode = DataGridViewColumnHeadersHeightSizeMode.AutoSize,
            RowTemplate = { Height = 32 },
            ScrollBars = ScrollBars.Vertical,
            Margin = new Padding(18, 8, 18, 8),
            EnableHeadersVisualStyles = false,
        };
        _grid.DefaultCellStyle.Padding = new Padding(6, 2, 6, 2);
        _grid.DefaultCellStyle.SelectionBackColor = Color.FromArgb(219, 234, 254);
        _grid.DefaultCellStyle.SelectionForeColor = Color.Black;
        _grid.ColumnHeadersDefaultCellStyle.Font = new Font("Segoe UI Semibold", 9.0f);
        _grid.ColumnHeadersDefaultCellStyle.BackColor = Color.FromArgb(243, 244, 246);
        _grid.ColumnHeadersDefaultCellStyle.ForeColor = Color.FromArgb(31, 41, 55);
        _grid.ColumnHeadersDefaultCellStyle.Padding = new Padding(6, 4, 6, 4);
        _grid.GridColor = Color.FromArgb(229, 231, 235);

        var colFile = new DataGridViewTextBoxColumn
        {
            Name = "File", HeaderText = "Soubor",
            AutoSizeMode = DataGridViewAutoSizeColumnMode.None,
            Width = 260,
            ReadOnly = true,
            DefaultCellStyle = new DataGridViewCellStyle { Font = new Font("Segoe UI Semibold", 9.0f) },
        };
        var colState = new DataGridViewTextBoxColumn
        {
            Name = "State", HeaderText = "Stav",
            AutoSizeMode = DataGridViewAutoSizeColumnMode.None,
            Width = 110,
            ReadOnly = true,
        };
        var colWeight = new DataGridViewComboBoxColumn
        {
            Name = "Weight", HeaderText = "Váha změny",
            AutoSizeMode = DataGridViewAutoSizeColumnMode.None,
            Width = 180,
            FlatStyle = FlatStyle.Flat,
            DisplayMember = "Label",
            ValueMember = "Key",
            DataSource = new List<WeightOption>
            {
                new(null,     "— vyberte —"),
                new("minor",  "Drobná (kosmetika)"),
                new("medium", "Střední (rozměry)"),
                new("major",  "Zásadní (funkce)"),
            },
        };
        var colNote = new DataGridViewTextBoxColumn
        {
            Name = "Note", HeaderText = "Poznámka (co se změnilo — volitelné)",
            AutoSizeMode = DataGridViewAutoSizeColumnMode.Fill,
            MinimumWidth = 240,
        };

        _grid.Columns.Add(colFile);
        _grid.Columns.Add(colState);
        _grid.Columns.Add(colWeight);
        _grid.Columns.Add(colNote);

        foreach (var e in _entries)
        {
            var idx = _grid.Rows.Add(
                e.FileName,
                e.ChangeState == "new" ? "⚡ Nový" : "⚡ Změněný",
                e.Weight,
                e.Note ?? "");
            var row = _grid.Rows[idx];
            row.Cells["State"].Style.ForeColor = e.ChangeState == "new"
                ? Color.FromArgb(22, 163, 74)
                : Color.FromArgb(202, 138, 4);
            row.Cells["State"].Style.Font = new Font("Segoe UI Semibold", 9.0f);
        }

        _grid.CurrentCellDirtyStateChanged += (s, ev) =>
        {
            if (_grid.IsCurrentCellDirty) _grid.CommitEdit(DataGridViewDataErrorContexts.Commit);
        };
        _grid.CellValueChanged += (s, ev) =>
        {
            if (ev.RowIndex < 0 || ev.RowIndex >= _entries.Count) return;
            var col = _grid.Columns[ev.ColumnIndex].Name;
            var entry = _entries[ev.RowIndex];
            if (col == "Weight")
                entry.Weight = _grid.Rows[ev.RowIndex].Cells["Weight"].Value as string;
            else if (col == "Note")
                entry.Note = _grid.Rows[ev.RowIndex].Cells["Note"].Value as string;
        };
        // ComboBox v DGV občas hází DataError (prázdná hodnota) — potlačíme.
        _grid.DataError += (s, ev) => ev.ThrowException = false;

        root.Controls.Add(_grid, 0, 1);

        // ── Patička s tlačítky ──────────────────────────────────────────────
        var footer = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            ColumnCount = 3,
            RowCount = 1,
            BackColor = Color.FromArgb(243, 244, 246),
            Padding = new Padding(18, 12, 18, 12),
        };
        footer.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100f)); // spacer
        footer.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 200f)); // OK
        footer.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 120f)); // Cancel

        _btnOk = new Button
        {
            Text = "Odeslat do HolyOSu",
            Dock = DockStyle.Fill,
            FlatStyle = FlatStyle.Flat,
            DialogResult = DialogResult.OK,
            BackColor = Color.FromArgb(59, 130, 246),
            ForeColor = Color.White,
            Font = new Font("Segoe UI Semibold", 9.5f),
            Margin = new Padding(0, 0, 8, 0),
            Height = 38,
        };
        _btnOk.FlatAppearance.BorderSize = 0;
        _btnOk.FlatAppearance.MouseOverBackColor = Color.FromArgb(37, 99, 235);

        _btnCancel = new Button
        {
            Text = "Zrušit",
            Dock = DockStyle.Fill,
            FlatStyle = FlatStyle.Flat,
            DialogResult = DialogResult.Cancel,
            BackColor = Color.White,
            ForeColor = Color.FromArgb(55, 65, 81),
            Height = 38,
        };
        _btnCancel.FlatAppearance.BorderColor = Color.FromArgb(209, 213, 219);
        _btnCancel.FlatAppearance.BorderSize = 1;

        footer.Controls.Add(new Panel { Dock = DockStyle.Fill, BackColor = Color.Transparent }, 0, 0);
        footer.Controls.Add(_btnOk, 1, 0);
        footer.Controls.Add(_btnCancel, 2, 0);

        root.Controls.Add(footer, 0, 2);

        AcceptButton = _btnOk;
        CancelButton = _btnCancel;
    }

    private sealed record WeightOption(string? Key, string Label);
}
