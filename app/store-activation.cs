using System;
using System.Runtime.InteropServices;

namespace CodexUsageInstalled {
    [ComImport, Guid("2e941141-7f97-4756-ba1d-9decde894a3d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IApplicationActivationManager {
        [PreserveSig]
        int ActivateApplication([MarshalAs(UnmanagedType.LPWStr)] string appUserModelId,
            [MarshalAs(UnmanagedType.LPWStr)] string arguments, uint options, out uint processId);
        [PreserveSig]
        int ActivateForFile([MarshalAs(UnmanagedType.LPWStr)] string appUserModelId,
            IntPtr itemArray, [MarshalAs(UnmanagedType.LPWStr)] string verb, out uint processId);
        [PreserveSig]
        int ActivateForProtocol([MarshalAs(UnmanagedType.LPWStr)] string appUserModelId,
            IntPtr itemArray, out uint processId);
    }

    public static class StoreActivation {
        public static uint Activate(string appUserModelId, string arguments) {
            var type = Type.GetTypeFromCLSID(new Guid("45ba127d-10a8-46ea-8ab7-56ea9078943c"), true);
            object instance = Activator.CreateInstance(type);
            try {
                uint processId;
                int result = ((IApplicationActivationManager)instance).ActivateApplication(
                    appUserModelId, arguments, 0, out processId); // AO_NONE: ordinary launch.
                Marshal.ThrowExceptionForHR(result);
                return processId;
            } finally {
                if (instance != null && Marshal.IsComObject(instance)) Marshal.FinalReleaseComObject(instance);
            }
        }
    }
}
