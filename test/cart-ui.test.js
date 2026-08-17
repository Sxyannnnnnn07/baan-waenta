const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const productHtml = fs.readFileSync(path.join(projectRoot, 'public', 'product.html'), 'utf8');
const mainJs = fs.readFileSync(path.join(projectRoot, 'public', 'js', 'main.js'), 'utf8');

test('product cart checkout button calls the implemented checkout handler', () => {
    assert.match(
        productHtml,
        /id="checkout-action-btn"[^>]*onclick="handleCheckoutClick\(\)"/
    );
    assert.match(mainJs, /function handleCheckoutClick\(\)/);
    assert.doesNotMatch(productHtml, /proceedCheckoutStep\(\)/);
});

test('order history supports the product page container', () => {
    assert.match(productHtml, /id="orders-list-content"/);
    assert.match(mainJs, /getElementById\('orders-list-content'\)/);
});
