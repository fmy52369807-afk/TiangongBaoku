const categories = require('../../shared/categories.json');

function categoryMeta(category) {
    return categories[category] || categories.other;
}

module.exports = {
    categories,
    categoryMeta,
};
