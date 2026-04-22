// =============================================================================
// HolyOS CAD Bridge — Přihlašovací dialog
// =============================================================================

using System;
using System.Drawing;
using System.Threading.Tasks;
using System.Windows.Forms;
using HolyOs.CadBridge.Transport;

namespace HolyOs.CadBridge.Forms;

public sealed class LoginForm : Form
{
    private readonly HolyOsClient _client;
    private readonly BridgeSettings _settings;

    private readonly TextBox _txtServer;
    private readonly TextBox _txtUsername;
    private readonly TextBox _txtPassword;
    private readonly Button _btnLogin;
    private readonly Label _lblStatus;

    public LoginForm(HolyOsClient client, BridgeSettings settings)
    {
        _client = client;
        _settings = settings;

        Text = "Přihlášení — HolyOS CAD Bridge";
        StartPosition = FormStartPosition.CenterScreen;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = false;
        Size = new Size(420, 270);
        Font = new Font("Segoe UI", 9.5f);

        try
        {
            using var s = typeof(LoginForm).Assembly.GetManifestResourceStream("app-icon.ico");
            if (s != null) Icon = new Icon(s);
        }
        catch { /* default ikonka */ }

        var lblServer = new Label { Text = "Adresa serveru:", Location = new Point(20, 22), Width = 120 };
        _txtServer = new TextBox { Location = new Point(140, 20), Width = 250, Text = settings.ServerUrl };

        var lblUser = new Label { Text = "Uživatelské jméno:", Location = new Point(20, 60), Width = 120 };
        _txtUsername = new TextBox { Location = new Point(140, 58), Width = 250 };

        var lblPwd = new Label { Text = "Heslo:", Location = new Point(20, 98), Width = 120 };
        _txtPassword = new TextBox { Location = new Point(140, 96), Width = 250, UseSystemPasswordChar = true };

        _btnLogin = new Button
        {
            Text = "Přihlásit",
            Location = new Point(140, 140),
            Width = 120,
            Height = 32,
            BackColor = Color.FromArgb(2, 132, 199),
            ForeColor = Color.White,
            FlatStyle = FlatStyle.Flat,
        };
        _btnLogin.FlatAppearance.BorderSize = 0;
        _btnLogin.Click += async (_, __) => await OnLoginAsync();

        var btnCancel = new Button
        {
            Text = "Zrušit",
            Location = new Point(270, 140),
            Width = 120,
            Height = 32,
            DialogResult = DialogResult.Cancel,
        };

        _lblStatus = new Label
        {
            Location = new Point(20, 185),
            Width = 370,
            Height = 40,
            ForeColor = Color.FromArgb(220, 38, 38),
        };

        Controls.AddRange(new Control[] {
            lblServer, _txtServer, lblUser, _txtUsername, lblPwd, _txtPassword,
            _btnLogin, btnCancel, _lblStatus });
        AcceptButton = _btnLogin;
        CancelButton = btnCancel;

        // Předvyplnit posledního uživatele
        var last = TokenStore.LoadToken();
        if (last != null && !string.IsNullOrEmpty(last.Username))
        {
            _txtUsername.Text = last.Username;
            _txtPassword.Focus();
        }
        else
        {
            _txtUsername.Focus();
        }
    }

    private async Task OnLoginAsync()
    {
        var url = _txtServer.Text.Trim();
        if (!url.StartsWith("http://", StringComparison.OrdinalIgnoreCase) &&
            !url.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
        {
            url = "https://" + url;
        }
        _settings.ServerUrl = url.TrimEnd('/');
        SettingsStore.Save(_settings);
        _client.SetBaseUrl(_settings.ServerUrl);

        _btnLogin.Enabled = false;
        _lblStatus.ForeColor = Color.FromArgb(100, 116, 139);
        _lblStatus.Text = "Přihlašuji…";

        try
        {
            var token = await _client.LoginAsync(_txtUsername.Text.Trim(), _txtPassword.Text);
            TokenStore.SaveToken(token);
            DialogResult = DialogResult.OK;
            Close();
        }
        catch (Exception ex)
        {
            _lblStatus.ForeColor = Color.FromArgb(220, 38, 38);
            _lblStatus.Text = "Nepodařilo se přihlásit: " + ex.Message;
        }
        finally
        {
            _btnLogin.Enabled = true;
        }
    }
}
