using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using System.Text;

namespace CodexMeter {
    public sealed class ShortcutInfo {
        public string TargetPath { get; set; }
        public string Arguments { get; set; }
        public string WorkingDirectory { get; set; }
        public string Description { get; set; }
        public string IconPath { get; set; }
        public int IconIndex { get; set; }
    }

    // Explicit Unicode interface; independent of the system ANSI code page.
    // https://learn.microsoft.com/windows/win32/api/shobjidl_core/nn-shobjidl_core-ishelllinkw
    [ComImport, Guid("000214F9-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IShellLinkW {
        void GetPath([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder path, int size, IntPtr findData, uint flags);
        void GetIDList(out IntPtr itemList);
        void SetIDList(IntPtr itemList);
        void GetDescription([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder description, int size);
        void SetDescription([MarshalAs(UnmanagedType.LPWStr)] string description);
        void GetWorkingDirectory([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder directory, int size);
        void SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] string directory);
        void GetArguments([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder arguments, int size);
        void SetArguments([MarshalAs(UnmanagedType.LPWStr)] string arguments);
        void GetHotkey(out short hotkey);
        void SetHotkey(short hotkey);
        void GetShowCmd(out int command);
        void SetShowCmd(int command);
        void GetIconLocation([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder icon, int size, out int index);
        void SetIconLocation([MarshalAs(UnmanagedType.LPWStr)] string icon, int index);
        void SetRelativePath([MarshalAs(UnmanagedType.LPWStr)] string path, uint reserved);
        void Resolve(IntPtr window, uint flags);
        void SetPath([MarshalAs(UnmanagedType.LPWStr)] string path);
    }

    [ComImport, Guid("00021401-0000-0000-C000-000000000046")]
    internal class ShellLink { }

    public static class ShortcutFile {
        public static void Write(string path, ShortcutInfo info) {
            object instance = new ShellLink();
            try {
                IShellLinkW link = (IShellLinkW)instance;
                link.SetPath(info.TargetPath);
                link.SetArguments(info.Arguments ?? "");
                link.SetWorkingDirectory(info.WorkingDirectory ?? "");
                link.SetDescription(info.Description ?? "");
                if (!String.IsNullOrEmpty(info.IconPath)) link.SetIconLocation(info.IconPath, info.IconIndex);
                ((IPersistFile)instance).Save(Path.GetFullPath(path), true);
            } finally { Marshal.FinalReleaseComObject(instance); }
        }

        public static ShortcutInfo Read(string path) {
            object instance = new ShellLink();
            try {
                ((IPersistFile)instance).Load(Path.GetFullPath(path), 0);
                IShellLinkW link = (IShellLinkW)instance;
                StringBuilder buffer = new StringBuilder(32768);
                ShortcutInfo info = new ShortcutInfo();
                link.GetPath(buffer, buffer.Capacity, IntPtr.Zero, 4); // SLGP_RAWPATH: do not resolve or launch.
                info.TargetPath = buffer.ToString();
                buffer.Clear(); link.GetArguments(buffer, buffer.Capacity); info.Arguments = buffer.ToString();
                buffer.Clear(); link.GetWorkingDirectory(buffer, buffer.Capacity); info.WorkingDirectory = buffer.ToString();
                buffer.Clear(); link.GetDescription(buffer, buffer.Capacity); info.Description = buffer.ToString();
                int iconIndex;
                buffer.Clear(); link.GetIconLocation(buffer, buffer.Capacity, out iconIndex);
                info.IconPath = buffer.ToString(); info.IconIndex = iconIndex;
                return info;
            } finally { Marshal.FinalReleaseComObject(instance); }
        }
    }
}
