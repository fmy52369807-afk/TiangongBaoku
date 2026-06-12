const fs = require('fs');

const mainPath = 'app/js/main.js';
let main = fs.readFileSync(mainPath, 'utf8');

const modules = [
    {
        file: 'app/js/api-client.js',
        names: ['api', 'apiPost'],
    },
    {
        file: 'app/js/payload-renderers.js',
        names: [
            'renderPayloadBody',
            'cleanMediaUrls',
            'proxyImageUrl',
            'imageLoadFallback',
            'renderDownloadLinks',
            'extractImageTags',
            'sanitizeMediaHtml',
            'sanitizeBasicHtml',
            'shortUrl',
        ],
    },
    {
        file: 'app/js/audio-player.js',
        names: ['audioCoverFallback', 'openAudioPlayer', 'closeAudioPlayer'],
    },
];

function findFunctionRange(source, name) {
    const startPattern = new RegExp(`(?:^|\\n)(?:async\\s+)?function\\s+${name}\\s*\\(`);
    const match = startPattern.exec(source);
    if (!match) return null;
    const start = match.index + (source[match.index] === '\n' ? 1 : 0);
    const nextPattern = /\n(?:async\s+)?function\s+[A-Za-z_$][\w$]*\s*\(/g;
    nextPattern.lastIndex = start + 1;
    const next = nextPattern.exec(source);
    const end = next ? next.index + 1 : source.length;
    return { start, end, text: source.slice(start, end).trimEnd() };
}

for (const mod of modules) {
    const chunks = [];
    for (const name of mod.names) {
        const range = findFunctionRange(main, name);
        if (!range) {
            if (fs.existsSync(mod.file)) continue;
            throw new Error(`Function not found: ${name}`);
        }
        chunks.push(range.text);
        main = main.slice(0, range.start) + main.slice(range.end);
    }
    if (chunks.length) {
        fs.writeFileSync(mod.file, chunks.join('\n\n') + '\n', 'utf8');
        console.log(`${mod.file}: moved ${chunks.length} functions`);
    } else {
        console.log(`${mod.file}: already split`);
    }
}

fs.writeFileSync(mainPath, main.replace(/\n{3,}/g, '\n\n'), 'utf8');

let html = fs.readFileSync('app/index.html', 'utf8');
const marker = '<script src="/js/main.js"></script>';
const replacement = [
    '<script src="/js/api-client.js"></script>',
    '<script src="/js/payload-renderers.js"></script>',
    '<script src="/js/audio-player.js"></script>',
    marker,
].join('\n');
if (html.includes(marker) && !html.includes('/js/api-client.js')) {
    html = html.replace(marker, replacement);
    fs.writeFileSync('app/index.html', html, 'utf8');
    console.log('app/index.html: added module script tags');
}
