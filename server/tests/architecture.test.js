const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { mapWithConcurrency } = require('../routes/utils');
const { categoryMeta, categories } = require('../routes/category-config');
const { isBlockedProxyHost, assertPublicProxyTarget } = require('../routes/proxy');
const { fetchUrl } = require('../engine/httpClient');
const {
    fallbackAntbywEntries,
    extractAntbywImageUrls,
    isBadComicImageUrl,
} = require('../routes/comic-fallback');

const root = path.join(__dirname, '..', '..');

test('mapWithConcurrency limits active workers and preserves item coverage', async () => {
    const items = Array.from({ length: 12 }, (_, index) => index);
    const seen = [];
    let active = 0;
    let maxActive = 0;

    await mapWithConcurrency(items, 3, async (item) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise(resolve => setTimeout(resolve, 5));
        seen.push(item);
        active -= 1;
    });

    assert.equal(maxActive, 3);
    assert.deepEqual(seen.sort((a, b) => a - b), items);
});

test('category config has required fallbacks and generated frontend metadata', () => {
    assert.equal(categoryMeta('missing-category'), categories.other);
    assert.equal(categoryMeta('novel').label, categories.novel.label);

    const generatedPath = path.join(root, 'app', 'js', 'category-meta.js');
    const generated = fs.readFileSync(generatedPath, 'utf8');

    for (const key of Object.keys(categories)) {
        assert.match(generated, new RegExp(`"${key}"\\s*:`));
        assert.match(generated, new RegExp(`"label"\\s*:\\s*"${escapeRegExp(categories[key].label)}"`));
    }

    assert.doesNotMatch(generated, /"icon"\s*:/);
    assert.doesNotMatch(generated, /"order"\s*:/);
});

test('media proxy blocks private network targets by default', async () => {
    assert.equal(isBlockedProxyHost('localhost'), true);
    assert.equal(isBlockedProxyHost('127.0.0.1'), true);
    assert.equal(isBlockedProxyHost('192.168.1.10'), true);
    assert.equal(isBlockedProxyHost('8.8.8.8'), false);

    await assert.rejects(
        () => assertPublicProxyTarget('localhost'),
        /Private network URLs are not allowed/
    );
});

test('http client uses the same private network policy as media proxy', async () => {
    await assert.rejects(
        () => fetchUrl('http://127.0.0.1:3456/api/version', {}, 100),
        /Private network URLs are not allowed/
    );
});

test('antbyw comic fallback normalizes relative read urls and filters loader assets', () => {
    const baseUrl = 'https://www.antbyw.com/plugin.php?id=jameson_manhua&c=index&a=bofang&kuid=198641';
    const html = `
        <ul>
            <li><a href="./plugin.php?id=jameson_manhua&a=read&zjid=1591365&kuid=198641">阅读</a></li>
            <li><a href="./plugin.php?id=jameson_manhua&a=read&zjid=1591365&kuid=198641">第1话</a></li>
            <li><a href="./plugin.php?id=jameson_manhua&a=read&kuid=198641&zjid=1591365">开始阅读</a></li>
        </ul>
    `;

    const entries = fallbackAntbywEntries(html, baseUrl);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].name, '第1话');
    assert.equal(
        entries[0].url,
        'https://www.antbyw.com/plugin.php?id=jameson_manhua&a=read&zjid=1591365&kuid=198641'
    );

    const raw = `
        <img src="/source/plugin/jameson_manhua/images/ajax-loader-2.gif">
        <script>
            let urls = ["https://imgmh3.antbyw.com/a/b/001.jpg.webp"];
        </script>
    `;
    const urls = extractAntbywImageUrls(raw, entries[0].url);
    assert.deepEqual(urls, ['https://imgmh3.antbyw.com/a/b/001.jpg.webp']);
    assert.equal(isBadComicImageUrl('https://www.antbyw.com/source/plugin/jameson_manhua/images/ajax-loader-2.gif'), true);
});

function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
