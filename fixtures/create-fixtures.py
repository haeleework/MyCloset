from pathlib import Path
from PIL import Image

# Synthetic grey images for metadata QA; these are not user clothing photographs.
folder = Path(__file__).resolve().parent
for name, moment in [('capture-a.jpg', '2026:10:06 09:00:00'), ('capture-b.jpg', '2026:10:06 09:05:00')]:
    exif = Image.Exif()
    exif[271] = 'QA synthetic'
    exif[272] = 'QA camera'
    exif[34665] = {36867: moment, 36881: '+09:00', 37385: 0, 41987: 0}
    output = folder / name
    if not output.exists():
        Image.new('RGB', (64, 64), (140, 140, 140)).save(output, exif=exif)
print('Synthetic EXIF fixtures ready')
