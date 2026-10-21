using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading;
using System.Windows.Forms;

internal static class StartUsage {
    [STAThread]
    private static int Main() {
        string root = AppDomain.CurrentDomain.BaseDirectory;
        string script = Path.GetFullPath(Path.Combine(root, "..", "app", "start-installed.ps1"));
        string powershell = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "PowerShell", "7", "pwsh.exe");
        if (!File.Exists(powershell)) {
            foreach (string directory in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(Path.PathSeparator)) {
                try {
                    string candidate = Path.Combine(directory.Trim().Trim('"'), "pwsh.exe");
                    if (Path.IsPathRooted(candidate) && File.Exists(candidate)) { powershell = Path.GetFullPath(candidate); break; }
                } catch (ArgumentException) { }
            }
        }
        try {
            using (var mutex = new Mutex(false, @"Local\CodexUsageDefaultEntry")) {
                if (!mutex.WaitOne(0)) return 0;
                try {
                    if (!File.Exists(script) || !File.Exists(powershell)) throw new IOException("找不到已验证的启动脚本或 PowerShell 7。请保留当前工具目录。");
                    var start = new ProcessStartInfo(powershell, "-NoProfile -File \"" + script + "\"") {
                        UseShellExecute = false, CreateNoWindow = true, WorkingDirectory = Path.GetDirectoryName(script),
                        RedirectStandardOutput = true, RedirectStandardError = true,
                        StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8
                    };
                    using (var process = Process.Start(start)) {
                        var output = process.StandardOutput.ReadToEndAsync();
                        var errors = process.StandardError.ReadToEndAsync();
                        process.WaitForExit();
                        string log = output.Result + Environment.NewLine + errors.Result;
                        File.WriteAllText(Path.Combine(root, "last-launch.log"), log, new UTF8Encoding(false));
                        if (process.ExitCode != 0) {
                            if (log.Length > 1800) log = log.Substring(log.Length - 1800);
                            throw new IOException("统计启动未完成。首次使用请先完整退出普通客户端，再从统计入口打开。\n\n" + log);
                        }
                    }
                    return 0;
                } finally { mutex.ReleaseMutex(); }
            }
        } catch (Exception error) {
            MessageBox.Show(error.Message, "ChatGPT（统计）", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return 1;
        }
    }
}
