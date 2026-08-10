const assert = require('node:assert/strict');
const test = require('node:test');
const { extractValue, extractList, applyTemplate, resolveUrl } = require('../engine/ruleParser');
const { runJsRule } = require('../engine/jsRuntime');

test('CSS selectors and modifiers extract text, attributes and lists', () => {
    const html = '<ul><li><a href="/one">One</a></li><li><a href="/two">Two</a></li></ul>';
    assert.equal(extractValue(html, 'tag.a@href', 'https://example.test/list'), '/one');
    assert.equal(extractValue(html, 'tag.a@text'), 'One');
    assert.equal(extractList(html, 'tag.li').length, 2);
});

test('JSONPath, fallback alternatives and templates are deterministic', () => {
    const json = '{"data":{"items":[{"name":"Alpha"},{"name":"Beta"}]}}';
    assert.deepEqual(extractList(json, '$.data.items[*]').map(item => item.name), ['Alpha', 'Beta']);
    assert.equal(extractValue(json, '$.data.missing || $.data.items[0].name'), 'Alpha');
    assert.equal(applyTemplate('/search/{{key}}/{{page}}', { key: 'demo', page: 2 }), '/search/demo/2');
    assert.equal(resolveUrl('../chapter/1', 'https://example.test/book/2'), 'https://example.test/chapter/1');
});

test('JavaScript rule sandbox supports rule helpers without network access', () => {
    const result = runJsRule('java.getString("h1@text")', {
        result: '<h1>Sandbox</h1>',
        baseUrl: 'https://example.test',
    });
    assert.equal(result, 'Sandbox');
    assert.equal(runJsRule('java.ajax("https://example.test")', { result: '' }), '');
});
