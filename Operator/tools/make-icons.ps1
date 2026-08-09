# Erzeugt die App-Icons fuer Operator.
# Motiv: der Level-Ring aus dem HUD mit dem Checklisten-Haken darin.
#
# Der Schein entsteht nicht durch gestapelte Konturen (das ergibt harte
# Ringe), sondern indem das Motiv winzig gerendert und dann bilinear
# hochskaliert darunter gelegt wird â€” das ist ein echter Weichzeichner.

Add-Type -AssemblyName System.Drawing

$ACC  = [System.Drawing.Color]::FromArgb(255,   0, 255, 163)   # --acc
$EDGE = [System.Drawing.Color]::FromArgb(255,   7,   6,  16)   # --bg
$MID  = [System.Drawing.Color]::FromArgb(255,  23,  19,  58)   # Aufhellung zur Mitte

# Zeichnet Ring + Haken in ein Graphics beliebiger Kantenlaenge.
function Draw-Motif {
  param($G, [double]$Size, [double]$Scale, $Color)

  $c  = $Size * 0.5
  $R  = $Size * 0.355 * $Scale
  $rw = $Size * 0.052 * $Scale

  $pen = New-Object System.Drawing.Pen($Color, [single]$rw)
  $G.DrawEllipse($pen, [single]($c-$R), [single]($c-$R), [single](2*$R), [single](2*$R))
  $pen.Dispose()

  # Haken bleibt klar innerhalb des Rings: groesster Abstand zur Mitte
  # ist der rechte Endpunkt mit 0.202 + halbe Strichbreite, der Ring
  # beginnt innen erst bei 0.329.
  $norm = @(@(0.340,0.510), @(0.450,0.620), @(0.670,0.390))
  $pts  = [System.Drawing.PointF[]]($norm | ForEach-Object {
    New-Object System.Drawing.PointF(
      [single]($c + ($_[0]-0.5)*$Size*$Scale),
      [single]($c + ($_[1]-0.5)*$Size*$Scale))
  })

  $pen = New-Object System.Drawing.Pen($Color, [single]($Size * 0.074 * $Scale))
  $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.EndCap   = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
  $G.DrawLines($pen, $pts)
  $pen.Dispose()
}

function New-Icon {
  param([int]$Size, [double]$Scale, [string]$Path, [switch]$NoGlow)

  $bmp = New-Object System.Drawing.Bitmap($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g   = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode      = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.PixelOffsetMode    = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality

  # --- Hintergrund: deckend, dann radiale Aufhellung leicht oberhalb der Mitte ---
  $g.Clear($EDGE)
  $o  = $Size * 0.30
  $bg = New-Object System.Drawing.Drawing2D.GraphicsPath
  $bg.AddEllipse([single](-$o), [single](-$o), [single]($Size + 2*$o), [single]($Size + 2*$o))
  $pgb = New-Object System.Drawing.Drawing2D.PathGradientBrush($bg)
  $pgb.CenterPoint    = New-Object System.Drawing.PointF([single]($Size*0.5), [single]($Size*0.44))
  $pgb.CenterColor    = $MID
  $pgb.SurroundColors = [System.Drawing.Color[]]@($EDGE)
  $g.FillPath($pgb, $bg)
  $pgb.Dispose(); $bg.Dispose()

  # --- Schein: Motiv klein rendern, unscharf hochskaliert darunterlegen ---
  # Unter etwa 64 px frisst der Schein die Konturen auf, dort flach lassen.
  if(-not $NoGlow -and $Size -ge 64){
    # Teiler 8 statt 14: enger Schein, und die Quelle ist gross genug,
    # dass beim Hochskalieren keine Bloecke sichtbar werden.
    $gs = [int][Math]::Max(16, [Math]::Round($Size / 8))
    $gb = New-Object System.Drawing.Bitmap($gs, $gs, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $gg = [System.Drawing.Graphics]::FromImage($gb)
    $gg.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $gg.Clear([System.Drawing.Color]::Transparent)
    Draw-Motif -G $gg -Size $gs -Scale $Scale -Color $ACC
    $gg.Dispose()

    $cm = New-Object System.Drawing.Imaging.ColorMatrix
    $cm.Matrix33 = 0.26                       # Deckkraft des Scheins
    $ia = New-Object System.Drawing.Imaging.ImageAttributes
    $ia.SetColorMatrix($cm)

    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBilinear
    $sp = [int]([Math]::Round($Size * 0.035)) # nur leicht ueber die Kontur hinaus
    $rect = New-Object System.Drawing.Rectangle((-$sp), (-$sp), ($Size + 2*$sp), ($Size + 2*$sp))
    $g.DrawImage($gb, $rect, 0, 0, $gs, $gs, [System.Drawing.GraphicsUnit]::Pixel, $ia)
    $ia.Dispose(); $gb.Dispose()
  }

  # --- Motiv scharf darueber ---
  Draw-Motif -G $g -Size $Size -Scale $Scale -Color $ACC

  $g.Dispose()
  $bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  "{0,-30} {1,4}x{1,-4} {2,7} Bytes" -f (Split-Path $Path -Leaf), $Size, (Get-Item $Path).Length
}

$dir = Join-Path (Split-Path $PSScriptRoot -Parent) "icons"
New-Item -ItemType Directory -Force -Path $dir | Out-Null

# Scale 1.00 = randlos fuer "any".
# Scale 0.90 haelt das Motiv in der 80-Prozent-Sicherheitszone fuer "maskable":
# aeusserer Radius 0.381 * 0.90 = 0.343, die Zone erlaubt 0.40.
New-Icon -Size 512 -Scale 1.00 -Path "$dir\icon-512.png"
New-Icon -Size 192 -Scale 1.00 -Path "$dir\icon-192.png"
New-Icon -Size 512 -Scale 0.90 -Path "$dir\icon-maskable-512.png"
New-Icon -Size 192 -Scale 0.90 -Path "$dir\icon-maskable-192.png"
New-Icon -Size 180 -Scale 1.00 -Path "$dir\apple-touch-icon.png"
New-Icon -Size  32 -Scale 1.00 -Path "$dir\favicon-32.png" -NoGlow

