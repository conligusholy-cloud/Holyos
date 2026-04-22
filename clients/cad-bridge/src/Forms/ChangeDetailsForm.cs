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
        Width = 900;
        Height = 520;
        StartPosition = FormStartPosition.CenterParent;
        MinimizeBox = false;
        MaximizeBox = false;
        FormBorderStyle = FormBorderStyle.Sizable;
        BackColor = Color.FromArgb(250, 250, 252);

        var lbl = new Label
        {
            Dock = DockStyle.Top,
            Height = 48,
            Padding = new Padding(16, 12, 16, 0),
            Text = "U každé položky vyber váhu změny (drobná / střední / zásadní).\n"
                 + "Poznámka je volitelná, ale ocení ji kolega ve výrobě.",
            Font = new Font("Segoe UI", 9.0f),
            ForeColor = Color.FromArgb(55, 65, 81),
        };
        Controls.Add(lbl);

        _grid = new DataGridView
        {
            Dock = DockStyle.Fill,
            BackgroundColor = Color.White,
            BorderStyle = BorderStyle.None,
            AllowUserToAddRows = false,
            AllowUserToDeleteRows = false,
            AllowUserToResizeRows = false,
            RowHeadersVisible = false,
            SelectionMode = DataGridViewSelectionMode.CellSelect,
            AutoSizeColumnsMode = DataGridViewAutoSizeColumnsMode.None,
            ColumnHeadersHeightSizeMode = DataGridViewColumnHeadersHeightSizeMode.AutoSize,
            Font = new Font("Segoe UI", 9.0f),
            Margin = new Padding(16),
        };
        _grid.DefaultCellStyle.Padding = new Padding(6);
        _grid.ColumnHeadersDefaultCellStyle.Font = new Font("Segoe UI Semibold", 9.0f);
        _grid.ColumnHeadersDefaultCellStyle.BackColor = Color.FromArgb(243, 244, 246);
        _grid.EnableHeadersVisualStyles = false;

        _grid.Columns.Add(new DataGridViewTextBoxColumn
        {
            Name = "File", HeaderText = "Soubor", Width = 280, ReadOnly = true,
            DefaultCellStyle = new DataGridViewCellStyle { Font = new Font("Segoe UI Semibold", 9.0f) },
        });
        _grid.Columns.Add(new DataGridViewTextBoxColumn
        {
            Name = "State", HeaderText = "Stav", Width = 110, ReadOnly = true,
        });
        _grid.Columns.Add(new DataGridViewComboBoxColumn
        {
            Name = "Weight", HeaderText = "Váha změny", Width = 170,
            DataSource = new[]
            {
                new WeightOption(null,     "— vyberte —"),
                new WeightOption("minor",  "Drobná (kosmetika)"),
                new WeightOption("medium", "Střední (rozměry)"),
                new WeightOption("major",  "Zásadní (funkce)"),
            },
            DisplayMember = "Label",
            ValueMember = "Key",
            FlatStyle = FlatStyle.Flat,
        });
        _grid.Columns.Add(new DataGridViewTextBoxColumn
        {
            Name = "Note", HeaderText = "Poznámka (co se změnilo — volitelné)",
            AutoSizeMode = DataGridViewAutoSizeColumnMode.Fill,
            MinimumWidth = 240,
        });

        foreach (var e in _entries)
        {
            var idx = _grid.Rows.Add(
                e.FileName,
                e.ChangeState == "new" ? "⚡ Nový" : "⚡ Změněný",
                e.Weight,
                e.Note ?? "");
            var row = _grid.Rows[idx];
            row.Cells["State"].Style.ForeColor = e.ChangeState == "new"
                ? Color.FromArgb(34, 197, 94)
                : Color.FromArgb(234, 179, 8);
            row.Cells["State"].Style.Font = new Font("Segoe UI Semibold", 9.0f);
        }

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
        // ComboBox commituje hodnotu až po přepnutí řádku — forcneme commit hned.
        _grid.CurrentCellDirtyStateChanged += (s, ev) =>
        {
            if (_grid.IsCurrentCellDirty) _grid.CommitEdit(DataGridViewDataErrorContexts.Commit);
        };

        Controls.Add(_grid);

        var footer = new Panel
        {
            Dock = DockStyle.Bottom,
            Height = 56,
            BackColor = Color.FromArgb(243, 244, 246),
            Padding = new Padding(16, 10, 16, 10),
        };

        _btnCancel = new Button
        {
            Text = "Zrušit",
            Dock = DockStyle.Right,
            Width = 110,
            Height = 36,
            FlatStyle = FlatStyle.Flat,
            DialogResult = DialogResult.Cancel,
        };
        _btnCancel.FlatAppearance.BorderColor = Color.FromArgb(209, 213, 219);
        _btnCancel.BackColor = Color.White;

        _btnOk = new Button
        {
            Text = "Odeslat do HolyOSu",
            Dock = DockStyle.Right,
            Width = 190,
            Height = 36,
            FlatStyle = FlatStyle.Flat,
            DialogResult = DialogResult.OK,
            BackColor = Color.FromArgb(59, 130, 246),
            ForeColor = Color.White,
            Font = new Font("Segoe UI Semibold", 9.0f),
            Margin = new Padding(8, 0, 0, 0),
        };
        _btnOk.FlatAppearance.BorderSize = 0;

        footer.Controls.Add(_btnOk);
        // Mezera mezi tlačítky — prázdný Panel.
        footer.Controls.Add(new Panel { Dock = DockStyle.Right, Width = 8 });
        footer.Controls.Add(_btnCancel);

        Controls.Add(footer);

        AcceptButton = _btnOk;
        CancelButton = _btnCancel;
    }

    private sealed record WeightOption(string? Key, string Label);
}
