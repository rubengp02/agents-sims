using System;
using System.Text;
using System.Runtime.InteropServices;
using System.Windows.Forms;
using System.Drawing;
public static class OfficeFolderPicker {
  [STAThread]
  public static int Main(string[] args) {
    try {
      if (args.Length == 1 && args[0] == "--self-test") {
        Console.Write(Convert.ToBase64String(Encoding.UTF8.GetBytes("native-ready")));
        return 0;
      }
      Application.EnableVisualStyles();
      string selected = Choose();
      if (selected != null) Console.Write(Convert.ToBase64String(Encoding.UTF8.GetBytes(selected)));
      return 0;
    } catch { return 1; }
  }
  [ComImport, Guid("42F85136-DB7E-439C-85F1-E4075D135FC8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IFileDialog {
    [PreserveSig] int Show(IntPtr owner);
    void SetFileTypes(uint count, IntPtr types);
    void SetFileTypeIndex(uint index);
    void GetFileTypeIndex(out uint index);
    void Advise(IntPtr events, out uint cookie);
    void Unadvise(uint cookie);
    void SetOptions(uint options);
    void GetOptions(out uint options);
    void SetDefaultFolder(IShellItem folder);
    void SetFolder(IShellItem folder);
    void GetFolder(out IShellItem folder);
    void GetCurrentSelection(out IShellItem item);
    void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string name);
    void GetFileName(out IntPtr name);
    void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string title);
    void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string text);
    void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string text);
    void GetResult(out IShellItem item);
  }
  [ComImport, Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IShellItem {
    void BindToHandler(IntPtr context, ref Guid handler, ref Guid iid, out IntPtr result);
    void GetParent(out IShellItem parent);
    void GetDisplayName(uint kind, out IntPtr name);
  }
  public static string Choose() {
    var dialog = (IFileDialog)Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("DC1C5A9C-E88A-4DDE-A5A1-60F82A20AEF7")));
    IShellItem item = null;
    IntPtr name = IntPtr.Zero;
    try {
      uint options; dialog.GetOptions(out options);
      dialog.SetOptions(options | 0x20 | 0x40 | 0x800 | 0x02000000);
      dialog.SetTitle("Elige la carpeta del proyecto");
      dialog.SetOkButtonLabel("Elegir carpeta");
      int result;
      using (var owner = new Form()) {
        owner.Text = "Elegir carpeta del proyecto";
        owner.ShowInTaskbar = false;
        owner.TopMost = true;
        owner.StartPosition = FormStartPosition.CenterScreen;
        owner.Size = new Size(1, 1);
        owner.Opacity = 0;
        owner.Show();
        owner.Activate();
        Application.DoEvents();
        result = dialog.Show(owner.Handle);
      }
      if (result == unchecked((int)0x800704C7)) return null;
      Marshal.ThrowExceptionForHR(result);
      dialog.GetResult(out item);
      item.GetDisplayName(0x80058000, out name);
      return Marshal.PtrToStringUni(name);
    } finally {
      if (name != IntPtr.Zero) Marshal.FreeCoTaskMem(name);
      if (item != null) Marshal.ReleaseComObject(item);
      Marshal.ReleaseComObject(dialog);
    }
  }
}
