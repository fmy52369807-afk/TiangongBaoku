const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const categoriesPath = path.join(root, 'shared', 'categories.json');
const outputPath = path.join(root, 'app', 'js', 'category-meta.js');
const categories = JSON.parse(fs.readFileSync(categoriesPath, 'utf8'));

const frontendMeta = Object.fromEntries(Object.entries(categories).map(([key, meta]) => [key, {
    label: meta.label,
    short: meta.short,
    placeholder: meta.placeholder,
    detail: meta.detail,
    list: meta.list,
    content: meta.content,
}]));

fs.writeFileSync(outputPath, `window.categoryMeta = ${JSON.stringify(frontendMeta, null, 2)};\n`, 'utf8');
console.log(`Wrote ${path.relative(root, outputPath)}`);
