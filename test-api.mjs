import fs from 'fs';

const formData = new FormData();
const files = ['home', 'heart', 'search', 'star'];

for (const name of files) {
  const buffer = fs.readFileSync(`./test-icons/${name}.svg`);
  const blob = new Blob([buffer], { type: 'image/svg+xml' });
  formData.append('svgs', blob, `${name}.svg`);
}

formData.append('scale', '2x');
formData.append('padding', '10');
formData.append('order', JSON.stringify(files));

console.log('Sending request...');
try {
  const res = await fetch('http://localhost:3001/api/generate-sprite', {
    method: 'POST',
    body: formData,
  });
  console.log('Status:', res.status);
  const data = await res.json();
  if (data.error) {
    console.log('Error:', data.error);
  } else {
    console.log('Sprite URL:', data.spriteUrl);
    console.log('Total width:', data.totalWidth, 'Height:', data.spriteHeight);
    console.log('CSS mappings count:', data.mappings.length);
    console.log('\nCSS code preview:\n');
    console.log(data.cssCode.slice(0, 500));
  }
} catch (e) {
  console.error('Request failed:', e.message);
}
