// One-off palette migration: crimson/plum -> Midnight & Sunshine. Usage: node scripts/recolor-midnight.js <files...>
const fs = require('fs');
const map = [
  ['#AD1744', '#2272EB'], ['#861235', '#1D5EC2'], ['#FCE8EF', '#EBF5FF'], ['#F2C6D4', '#BFDBFE'], ['#FBE9EE', '#EBF5FF'],
  ['#FFFDF9', '#F7F8FA'], ['#FFFDFA', '#F7F8FA'], ['#FFFDF8', '#F7F8FA'], ['#F7F2F4', '#F2F5FA'], ['#EEE6E9', '#E2E8F0'], ['#E8B3C3', '#A9C0DC'],
  ['#111111', '#0F1B2D'], ['#292929', '#1A293E'], ['#171916', '#0F1B2D'], ['#171717', '#0F1B2D'], ['#080808', '#0B1422'],
  ['#3B1124', '#0F1B2D'], ['#4A182F', '#1A293E'], ['#F9E2EC', '#DCEBFF'], ['#2A0D16', '#0F1B2D'], ['#FAF5EE', '#F0F4F8'],
  ['#FF5C67', '#FFC93C'], ['#E04853', '#E5B22B'], ['#F2CEDB', '#C9DEFA'], ['#F5ECEE', '#EEF2F7'], ['#F4E8ED', '#FFFFFF'], ['#EAD5DE', '#E2E8F0'],
  ['#FBF6F8', '#F7F8FA'], ['#EADEE3', '#E2E8F0'], ['#E2D2D7', '#E2E8F0'], ['#FFC2CB', '#FFC93C'], ['#3A2A30', '#33445C'], ['#F0E1E7', '#E2E8F0'],
  ['#FFF0E7', '#FFF8E1'], ['#BD4A16', '#B45309'], ['#EEE9E4', '#E2E8F0'], ['#E3D8C8', '#E2E8F0'], ['#DED5C8', '#E2E8F0'], ['#EEEAE6', '#E2E8F0'],
  ['#7A6E73', '#5A6B82'], ['#5D5358', '#5A6B82'], ['#514943', '#5A6B82'], ['#29231F', '#0F1B2D'], ['#E6D8DD', '#E2E8F0'], ['#F4EEF0', '#EEF2F7']
];
const rgba = [[/rgba\(\s*173\s*,\s*23\s*,\s*68/g, 'rgba(34,114,235'], [/rgba\(\s*59\s*,\s*17\s*,\s*36/g, 'rgba(15,27,45'], [/rgba\(\s*255\s*,\s*92\s*,\s*103/g, 'rgba(255,201,60'], [/#111\b/gi, '#0F1B2D']];
for (const f of process.argv.slice(2)) {
  let s = fs.readFileSync(f, 'utf8'), n = 0;
  for (const [a, b] of map) s = s.replace(new RegExp(a + '(?![0-9a-fA-F])', 'gi'), () => (n++, b));
  for (const [re, b] of rgba) s = s.replace(re, () => (n++, b));
  fs.writeFileSync(f, s);
  console.log(f, n);
}
