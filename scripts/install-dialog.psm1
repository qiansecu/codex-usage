Set-StrictMode -Version Latest
function New-UsageInstallDialog {
    param([bool]$Running, [ValidateSet('Light','Dark')][string]$Theme = 'Light')
    Add-Type -AssemblyName PresentationFramework
    Add-Type -AssemblyName PresentationCore
    Add-Type -AssemblyName WindowsBase
    $colors = if ($Theme -eq 'Dark') {
        @{Surface='#252525';Border='#414141';Text='#F5F5F5';Muted='#B4B4B4';Primary='#F5F5F5';PrimaryText='#171717'}
    } else { @{Surface='#FFFFFF';Border='#DEDEDE';Text='#171717';Muted='#5D5D5D';Primary='#171717';PrimaryText='#FFFFFF'} }
    $markup = @'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml" Title="Codex Meter" Width="508" Height="272" WindowStyle="None" AllowsTransparency="True" Background="Transparent" ResizeMode="NoResize" WindowStartupLocation="CenterScreen" FontFamily="Microsoft YaHei UI, Segoe UI" UseLayoutRounding="True">
 <Window.Resources>
  <Style x:Key="Quiet" TargetType="Button">
   <Setter Property="Foreground" Value="@Text@"/><Setter Property="Background" Value="@Surface@"/><Setter Property="BorderBrush" Value="@Border@"/><Setter Property="BorderThickness" Value="1"/>
   <Setter Property="FontSize" Value="13"/><Setter Property="Padding" Value="18,0"/><Setter Property="Height" Value="36"/><Setter Property="Cursor" Value="Hand"/>
   <Setter Property="Template"><Setter.Value><ControlTemplate TargetType="Button">
    <Border x:Name="Pill" Background="{TemplateBinding Background}" BorderBrush="{TemplateBinding BorderBrush}" BorderThickness="{TemplateBinding BorderThickness}" CornerRadius="18" Padding="{TemplateBinding Padding}"><ContentPresenter HorizontalAlignment="Center" VerticalAlignment="Center"/></Border>
    <ControlTemplate.Triggers>
     <Trigger Property="IsMouseOver" Value="True"><Setter TargetName="Pill" Property="Opacity" Value="0.78"/></Trigger>
     <Trigger Property="IsKeyboardFocused" Value="True"><Setter TargetName="Pill" Property="BorderBrush" Value="#8F8F8F"/><Setter TargetName="Pill" Property="BorderThickness" Value="2"/></Trigger>
    </ControlTemplate.Triggers>
   </ControlTemplate></Setter.Value></Setter>
  </Style>
 </Window.Resources>
 <Border x:Name="Card" Margin="14" Background="@Surface@" BorderBrush="@Border@" BorderThickness="1" CornerRadius="20">
  <Border.Effect><DropShadowEffect BlurRadius="20" ShadowDepth="3" Opacity="0.14"/></Border.Effect>
  <Grid Margin="26,23,26,23">
   <Grid.RowDefinitions><RowDefinition Height="Auto"/><RowDefinition Height="*"/><RowDefinition Height="Auto"/></Grid.RowDefinitions>
   <TextBlock x:Name="Heading" Text="启用用量统计" Foreground="@Text@" FontSize="19" FontWeight="SemiBold" Margin="0,0,35,0"/>
   <Button x:Name="Close" Content="×" Style="{StaticResource Quiet}" Width="28" Height="28" Padding="0" FontSize="20" BorderThickness="0" Foreground="@Muted@" HorizontalAlignment="Right" VerticalAlignment="Top" Margin="0,-3,-7,0" AutomationProperties.Name="关闭，稍后启动"/>
   <TextBlock x:Name="Body" Grid.Row="1" Foreground="@Muted@" FontSize="13" LineHeight="21" TextWrapping="Wrap" Margin="0,17,0,18"/>
   <StackPanel Grid.Row="2" Orientation="Horizontal" HorizontalAlignment="Right">
    <Button x:Name="Later" Content="稍后再说" Style="{StaticResource Quiet}" IsDefault="True" IsCancel="True" MinWidth="100" Margin="0,0,10,0"/>
    <Button x:Name="Proceed" Content="保存并重启" Style="{StaticResource Quiet}" Background="@Primary@" Foreground="@PrimaryText@" BorderThickness="0" MinWidth="112"/>
   </StackPanel>
  </Grid>
 </Border>
</Window>
'@
    foreach ($key in $colors.Keys) { $markup = $markup.Replace('@'+$key+'@',$colors[$key]) }
    $view = [Windows.Markup.XamlReader]::Parse($markup)
    $view.FindName('Body').Text = if ($Running) {
        @('安装准备已完成。现在从统计启动器重启客户端吗？','','请先保存工作。重启会关闭窗口和后台进程，','可能中断正在运行的任务。') -join [Environment]::NewLine
    } else { @('安装准备已完成。现在从统计启动器打开客户端吗？','','也可以稍后通过新入口启用用量统计。') -join [Environment]::NewLine }
    if (-not $Running) { $view.FindName('Proceed').Content = '立即启动' }
    $view.FindName('Proceed').Add_Click({ $view.DialogResult = $true }.GetNewClosure())
    $view.FindName('Later').Add_Click({ $view.DialogResult = $false }.GetNewClosure())
    $view.FindName('Close').Add_Click({ $view.Close() }.GetNewClosure())
    $view.FindName('Heading').Add_MouseLeftButtonDown({ $view.DragMove() }.GetNewClosure())
    return $view
}
function Show-UsageInstallDialog {
    param([bool]$Running)
    $theme = 'Light'
    try { if ((Get-ItemPropertyValue -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize' -Name AppsUseLightTheme -ErrorAction Stop) -eq 0) { $theme = 'Dark' } } catch { }
    $view = New-UsageInstallDialog -Running $Running -Theme $theme
    $view.Add_ContentRendered({ $view.FindName('Later').Focus() | Out-Null }.GetNewClosure())
    return $view.ShowDialog() -eq $true
}
function Export-UsageInstallDialogPreview {
    param([Parameter(Mandatory)][string]$Path, [ValidateSet('Light','Dark')][string]$Theme = 'Light')
    # Render actual WPF content without showing a dialog or invoking any installation action.
    $view = New-UsageInstallDialog -Running $true -Theme $Theme
    $root = $view.Content
    $root.Measure([Windows.Size]::new(508,272)); $root.Arrange([Windows.Rect]::new(0,0,508,272)); $root.UpdateLayout()
    $bitmap = [Windows.Media.Imaging.RenderTargetBitmap]::new(762,408,144,144,[Windows.Media.PixelFormats]::Pbgra32)
    $bitmap.Render($root)
    $encoder = [Windows.Media.Imaging.PngBitmapEncoder]::new(); $encoder.Frames.Add([Windows.Media.Imaging.BitmapFrame]::Create($bitmap))
    $stream = [IO.File]::Create([IO.Path]::GetFullPath($Path))
    try { $encoder.Save($stream) } finally { $stream.Dispose(); $view.Close() }
}
Export-ModuleMember -Function Show-UsageInstallDialog,Export-UsageInstallDialogPreview