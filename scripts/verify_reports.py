"""Extract, render and prepare page contact sheets; visual inspection remains required."""
from pathlib import Path
import argparse
import json
import subprocess
import pdfplumber
from PIL import Image, ImageOps, ImageDraw

parser = argparse.ArgumentParser()
parser.add_argument('directory', nargs='?', default=str(Path(__file__).resolve().parents[1] / 'data' / 'report-samples'))
args = parser.parse_args()
directory = Path(args.directory).resolve()
results = []
for pdf in sorted(directory.glob('*.pdf')):
    target = directory / 'qa' / pdf.stem
    target.mkdir(parents=True, exist_ok=True)
    subprocess.run(['pdfinfo', str(pdf)], check=True, capture_output=True)
    with pdfplumber.open(pdf) as doc:
        texts = [page.extract_text() or '' for page in doc.pages]
        clipped = []
        for i, page in enumerate(doc.pages):
            outside = [c for c in page.chars if c['x0'] < -1 or c['x1'] > page.width + 1 or c['top'] < -1 or c['bottom'] > page.height + 1]
            if outside:
                clipped.append({'page': i + 1, 'characters': len(outside)})
        assert not clipped, (pdf.name, clipped)
        assert all(len(text.strip()) > 40 for text in texts), 'Empty or nearly empty report page'
        text = '\n'.join(texts)
        for heading in ['评分总览', '总体评议', '六维度详细评审', '修改清单', '评审依据']:
            assert heading in text, (pdf.name, 'missing heading', heading)
        assert '\ufffd' not in text, 'Replacement characters in PDF'
        (target / 'extracted.txt').write_text(text, encoding='utf-8')
        result = {'file': pdf.name, 'pages': len(doc.pages), 'characters': len(text), 'out_of_page_characters': clipped, 'text_checks': 'passed'}
    subprocess.run(['pdftoppm', '-r', '90', '-png', str(pdf), str(target / 'page')], check=True, capture_output=True)
    images = sorted((p for p in target.glob('page-*.png') if int(p.stem.split('-')[-1]) <= len(texts)), key=lambda p: int(p.stem.split('-')[-1]))
    for start in range(0, len(images), 4):
        contact = Image.new('RGB', (860, 1260), '#dde2e6')
        draw = ImageDraw.Draw(contact)
        for index, image_path in enumerate(images[start:start + 4]):
            with Image.open(image_path) as im:
                thumb = ImageOps.contain(im.convert('RGB'), (410, 590))
            x = 10 + (index % 2) * 430
            y = 25 + (index // 2) * 630
            draw.text((x, y - 18), f'{pdf.stem} / {start + index + 1}', fill='black')
            contact.paste(thumb, (x, y))
        contact.save(target / f'contact-{start // 4 + 1}.png')
    results.append(result)
    print(json.dumps(result, ensure_ascii=False))
(directory / 'qa-report.json').write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding='utf-8')
