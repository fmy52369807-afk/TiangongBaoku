const fs = require('fs');

const indexPath = 'app/index.html';
let html = fs.readFileSync(indexPath, 'utf8');

const styleStart = html.indexOf('<style>');
const styleEnd = html.indexOf('</style>', styleStart);
const scriptStart = html.indexOf('<script>');
const scriptEnd = html.lastIndexOf('</script>');

if (styleStart < 0 && scriptStart < 0 && html.includes('/css/app.css') && html.includes('/js/main.js')) {
    console.log('index.html already references external app assets.');
    process.exit(0);
}

if (styleStart < 0 || styleEnd < 0 || scriptStart < 0 || scriptEnd < 0) {
    throw new Error('inline style/script tags not found');
}

const css = html.slice(styleStart + '<style>'.length, styleEnd).trimStart();
const js = html.slice(scriptStart + '<script>'.length, scriptEnd).trimStart();

fs.mkdirSync('app/css', { recursive: true });
fs.mkdirSync('app/js', { recursive: true });
fs.writeFileSync('app/css/app.css', css, 'utf8');
fs.writeFileSync('app/js/main.js', js, 'utf8');

html = html.slice(0, styleStart)
    + '<link rel="stylesheet" href="/css/app.css">\n'
    + html.slice(styleEnd + '</style>'.length, scriptStart)
    + '<script src="/js/main.js"></script>\n'
    + html.slice(scriptEnd + '</script>'.length);

fs.writeFileSync(indexPath, html, 'utf8');

console.log(JSON.stringify({
    cssBytes: Buffer.byteLength(css),
    jsBytes: Buffer.byteLength(js),
    htmlBytes: Buffer.byteLength(html),
}, null, 2));
