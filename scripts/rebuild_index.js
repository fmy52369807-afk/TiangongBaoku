/**
 * Rebuild sources/index.json from the current split source files.
 *
 * This does not rewrite any source JSON files. Use it after manually adding,
 * pruning, or editing entries in sources/<category>/*.json.
 */
const fs = require('fs');
const path = require('path');

const SOURCES_DIR = path.join(__dirname, '..', 'sources');

const FILES = [
    ['novel/free_novel.json', 'novel'],
    ['novel/official_novel.json', 'novel'],
    ['comic/free_comic.json', 'comic'],
    ['comic/official_comic.json', 'comic'],
    ['audio/audiobook.json', 'audio'],
    ['music/music_sources.json', 'music'],
    ['video/video.json', 'video'],
    ['game/game.json', 'game'],
    ['special/special.json', 'special'],
];

const index = [];
let idCounter = 1;

for (const [file, category] of FILES) {
    const fullPath = path.join(SOURCES_DIR, file);
    if (!fs.existsSync(fullPath)) continue;
    const entries = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
    entries.forEach((source, idx) => {
        index.push({
            id: `src_${String(idCounter).padStart(4, '0')}`,
            name: source.bookSourceName || '',
            group: source.bookSourceGroup || '',
            category,
            url: source.bookSourceUrl || '',
            type: source.bookSourceType ?? 0,
            enabled: source.enabled ?? true,
            weight: source.weight ?? 0,
            comment: String(source.bookSourceComment || '').slice(0, 100),
            status: source.enabled === false ? 'disabled' : 'ok',
            file,
            index: idx,
        });
        idCounter++;
    });
}

fs.writeFileSync(path.join(SOURCES_DIR, 'index.json'), JSON.stringify(index, null, 2), 'utf8');
console.log(`Rebuilt sources/index.json with ${index.length} entries.`);
