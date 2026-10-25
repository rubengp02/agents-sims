using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Web.Script.Serialization;
using System.Windows.Automation;
using System.Windows.Forms;

// No shell execution. Window identity and foreground are verified again immediately before input.
class OfficeDesktop {
  delegate bool EnumProc(IntPtr hwnd, IntPtr param);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback, IntPtr param);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr hwnd);
  [DllImport("user32.dll")] static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int max);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
  [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] static extern void mouse_event(uint flags, uint x, uint y, uint data, UIntPtr extra);
  [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
  struct RECT { public int Left, Top, Right, Bottom; }
  static JavaScriptSerializer json = new JavaScriptSerializer { MaxJsonLength = 30000000 };
  static string Text(Dictionary<string, object> input, string key) { return Convert.ToString(input[key]); }
  static void Verify(IntPtr handle, uint expected, bool foreground) {
    uint actual; GetWindowThreadProcessId(handle, out actual);
    if (!IsWindow(handle) || actual != expected || (foreground && GetForegroundWindow() != handle)) throw new Exception("La ventana objetivo cambió o perdió el foco; operación detenida.");
  }
  [STAThread] static void Main(string[] args) {
    try { SetProcessDPIAware(); Console.WriteLine(json.Serialize(Run(json.Deserialize<Dictionary<string, object>>(args[0])))); }
    catch (Exception error) { Console.WriteLine(json.Serialize(new { error = "Windows rechazó la operación: " + error.Message })); }
  }
  static object Run(Dictionary<string, object> input) {
    string action = Text(input, "action");
    if (action == "windows") {
      var windows = new List<object>();
      EnumWindows(delegate(IntPtr handle, IntPtr ignored) {
        if (IsWindowVisible(handle)) {
          var title = new StringBuilder(1024); GetWindowText(handle, title, title.Capacity);
          uint pid; GetWindowThreadProcessId(handle, out pid);
          if (title.Length > 0) windows.Add(new { handle = handle.ToInt64().ToString(), processId = pid, title = title.ToString(), foreground = GetForegroundWindow() == handle });
        }
        return true;
      }, IntPtr.Zero);
      return new { windows = windows };
    }
    IntPtr target = new IntPtr(Int64.Parse(Text(input, "handle")));
    uint expected = Convert.ToUInt32(input["processId"]);
    Verify(target, expected, action == "click" || action == "keys");
    RECT bounds; if (!GetWindowRect(target, out bounds)) throw new Exception("No se pueden leer los límites de la ventana.");
    if (action == "inspect") {
      var controls = new List<object>();
      AutomationElement root = AutomationElement.FromHandle(target);
      var elements = root.FindAll(TreeScope.Descendants, Condition.TrueCondition);
      for (int index = 0; index < Math.Min(elements.Count, 500); index++) {
        try {
          var current = elements[index].Current; var rect = current.BoundingRectangle;
          if (rect.IsEmpty || Double.IsInfinity(rect.X) || Double.IsInfinity(rect.Y) || Double.IsNaN(rect.X) || Double.IsNaN(rect.Y)) continue;
          controls.Add(new { name = current.Name, automationId = current.AutomationId, controlType = current.ControlType.ProgrammaticName, enabled = current.IsEnabled, x = rect.X - bounds.Left, y = rect.Y - bounds.Top, width = rect.Width, height = rect.Height });
        } catch (ElementNotAvailableException) { }
      }
      Verify(target, expected, false); return new { controls = controls };
    }
    if (action == "screenshot") {
      if (GetForegroundWindow() != target) throw new Exception("Selecciona la ventana objetivo para capturarla sin otras ventanas delante.");
      int width = bounds.Right - bounds.Left, height = bounds.Bottom - bounds.Top;
      if (width <= 0 || height <= 0 || width > 10000 || height > 10000) throw new Exception("Tamaño de ventana no admitido.");
      using (var bitmap = new Bitmap(width, height)) using (var graphics = Graphics.FromImage(bitmap)) using (var stream = new MemoryStream()) {
        Verify(target, expected, true); graphics.CopyFromScreen(bounds.Left, bounds.Top, 0, 0, new Size(width, height)); Verify(target, expected, true);
        bitmap.Save(stream, ImageFormat.Png); return new { image = Convert.ToBase64String(stream.ToArray()) };
      }
    }
    if (action == "click") {
      int x = Convert.ToInt32(input["x"]), y = Convert.ToInt32(input["y"]);
      if (x < 0 || y < 0 || x >= bounds.Right - bounds.Left || y >= bounds.Bottom - bounds.Top) throw new Exception("El clic queda fuera de la ventana objetivo.");
      Verify(target, expected, true);
      if (!SetCursorPos(bounds.Left + x, bounds.Top + y)) throw new Exception("Windows no permite mover el puntero.");
      Verify(target, expected, true); mouse_event(2, 0, 0, 0, UIntPtr.Zero); mouse_event(4, 0, 0, 0, UIntPtr.Zero);
      return new { completed = true };
    }
    if (action == "keys") { Verify(target, expected, true); SendKeys.SendWait(Text(input, "keys")); Verify(target, expected, true); return new { completed = true }; }
    throw new Exception("Acción desconocida.");
  }
}
