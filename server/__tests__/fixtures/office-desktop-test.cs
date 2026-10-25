using System;
using System.IO;
using System.Windows.Forms;
class OfficeDesktopTest {
  [STAThread] static void Main(string[] args) {
    var form = new Form { Text = "Office owned integration fixture", Width = 420, Height = 200, StartPosition = FormStartPosition.CenterScreen };
    var input = new TextBox { Name = "fixture-input", Left = 30, Top = 30, Width = 300 };
    var save = new Button { Name = "fixture-save", Text = "Guardar prueba local", Left = 30, Top = 75, Width = 220 };
    save.Click += delegate { File.WriteAllText(args[0], input.Text); };
    form.Controls.Add(input); form.Controls.Add(save);
    form.Shown += delegate { form.Activate(); input.Focus(); File.WriteAllText(args[1], form.Handle.ToInt64().ToString()); };
    Application.Run(form);
  }
}
