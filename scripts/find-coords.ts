import sharp from 'sharp'
import path from 'path'

const TEMPLATE = path.join(process.cwd(), 'Empty Invoice AZERAKOL.ID_Pigeon May_INV-AZK-202605-014.png')

async function main() {
  const svg = `<svg width="1240" height="1754" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <style>text { font-family: "Helvetica Neue", Arial, sans-serif; }</style>
    </defs>

    <!-- Fine-grained ruler around invoice NO / issue date area (300-500) -->
    ${[300,310,320,330,340,350,360,370,380,390,400,410,420,430,440,450,460,470,480,490,500].map(y =>
      `<line x1="700" y1="${y}" x2="1240" y2="${y}" stroke="red" stroke-width="1" opacity="0.6"/>
       <text x="705" y="${y-2}" font-size="11" fill="red">${y}</text>`
    ).join('\n')}

    <!-- Fine-grained ruler around subtotal area (1130-1400) -->
    ${[1130,1140,1150,1160,1170,1180,1190,1200,1210,1220,1230,1240,1250,1260,1270,1280,1290,1300,1310,1320,1330,1340,1350,1360,1370,1380,1390,1400].map(y =>
      `<line x1="500" y1="${y}" x2="1240" y2="${y}" stroke="blue" stroke-width="1" opacity="0.5"/>
       <text x="505" y="${y-2}" font-size="11" fill="blue">${y}</text>`
    ).join('\n')}

    <!-- Test values — Invoice NO and Issue Date candidates -->
    <text x="820" y="368" font-size="24" font-weight="bold" fill="red">INV-AZK-202605-001</text>
    <text x="820" y="408" font-size="17" fill="red">408 — issue date?</text>
    <text x="820" y="420" font-size="17" fill="blue">420 — issue date?</text>
    <text x="820" y="432" font-size="17" fill="green">432 — issue date?</text>
    <text x="820" y="444" font-size="17" fill="purple">444 — issue date?</text>

    <!-- Test subtotal / total candidates -->
    <text x="1145" y="1182" font-size="20" fill="red" text-anchor="end">1182 subtotal?</text>
    <text x="1145" y="1200" font-size="20" fill="blue" text-anchor="end">1200 subtotal?</text>

    <text x="1145" y="1340" font-size="24" font-weight="bold" fill="red" text-anchor="end">1340 total?</text>
    <text x="1145" y="1355" font-size="24" font-weight="bold" fill="blue" text-anchor="end">1355 total?</text>
    <text x="1145" y="1370" font-size="24" font-weight="bold" fill="green" text-anchor="end">1370 total?</text>

    <!-- Items area ruler (900-1200) -->
    ${[900,910,920,930,940,950,960,970,980,990,1000,1010,1020,1030,1040,1050,1060,1070,1080,1090,1100,1110,1120,1130,1140,1150].map(y =>
      `<line x1="0" y1="${y}" x2="90" y2="${y}" stroke="green" stroke-width="1" opacity="0.6"/>
       <text x="2" y="${y-2}" font-size="10" fill="green">${y}</text>`
    ).join('\n')}

    <!-- Test item positions -->
    <text x="100" y="985" font-size="20" font-weight="bold" fill="red">985 Pigeon Nano</text>
    <text x="100" y="1011" font-size="16" fill="red">1011 1x VT + IG Reels</text>
    <text x="617" y="993" font-size="20" fill="red" text-anchor="middle">17</text>
    <text x="875" y="993" font-size="20" fill="red" text-anchor="end">Rp150.000</text>
    <text x="1145" y="993" font-size="20" font-weight="bold" fill="red" text-anchor="end">Rp2.550.000</text>

    <text x="100" y="1078" font-size="20" font-weight="bold" fill="blue">1078 Pigeon Micro</text>
    <text x="100" y="1104" font-size="16" fill="blue">1104 1x VT + IG Reels</text>
    <text x="617" y="1086" font-size="20" fill="blue" text-anchor="middle">15</text>
    <text x="875" y="1086" font-size="20" fill="blue" text-anchor="end">Rp250.000</text>
    <text x="1145" y="1086" font-size="20" font-weight="bold" fill="blue" text-anchor="end">Rp3.750.000</text>
  </svg>`

  await sharp(TEMPLATE)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .toFile(path.join(process.cwd(), 'assets', 'coords-debug.png'))

  console.log('Saved assets/coords-debug.png')
}

main().catch(console.error)
