const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '../lib/orderPackaging.ts'), 'utf8');
const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const moduleExports = {};
new Function('exports', 'require', compiled)(moduleExports, require);

const { findIndividualPackaging, normalizePackageId, canChoosePackaging } = moduleExports;

const choppedChicken = { id: 1, name: 'Darabolt csirke' };
const wholeChicken = { id: 2, name: 'Egész csirke' };

test('findIndividualPackaging recognizes the historical "Egyedi" name', () => {
    const packages = [
        { id: 1, name: 'Egyedi csomagolás' },
        { id: 2, name: 'Gyűjtő csomagolás' },
    ];

    assert.equal(findIndividualPackaging(packages)?.id, 1);
});

test('findIndividualPackaging recognizes the current live "Egyenként" name', () => {
    const packages = [
        { id: 1, name: 'Egyenként' },
        { id: 2, name: 'Gyűjtő csomagolás' },
    ];

    assert.equal(findIndividualPackaging(packages)?.id, 1);
});

test('findIndividualPackaging is case- and whitespace-insensitive for both names', () => {
    const packages = [
        { id: 5, name: '  EGYEDI csomagolás  ' },
    ];
    assert.equal(findIndividualPackaging(packages)?.id, 5);

    const packages2 = [
        { id: 6, name: '  Egyenként  ' },
    ];
    assert.equal(findIndividualPackaging(packages2)?.id, 6);
});

test('findIndividualPackaging returns undefined when neither name is present', () => {
    const packages = [
        { id: 2, name: 'Gyűjtő csomagolás' },
    ];

    assert.equal(findIndividualPackaging(packages), undefined);
});

test('normalizePackageId keeps a valid non-null package id for items that do not require packaging choice, regardless of the "individual" package naming', () => {
    const packagesWithEgyedi = [
        { id: 1, name: 'Egyedi csomagolás' },
        { id: 2, name: 'Gyűjtő csomagolás' },
    ];
    const packagesWithEgyenkent = [
        { id: 1, name: 'Egyenként' },
        { id: 2, name: 'Gyűjtő csomagolás' },
    ];

    assert.equal(canChoosePackaging(wholeChicken, 3), false);

    assert.equal(
        normalizePackageId({
            product: wholeChicken,
            quantity: 3,
            selectedPackageId: 1,
            packages: packagesWithEgyedi,
        }),
        1
    );

    assert.equal(
        normalizePackageId({
            product: wholeChicken,
            quantity: 3,
            selectedPackageId: 1,
            packages: packagesWithEgyenkent,
        }),
        1
    );
});

test('normalizePackageId keeps a chosen packaging id for items that do require packaging choice', () => {
    const packages = [
        { id: 1, name: 'Egyenként' },
        { id: 2, name: 'Gyűjtő csomagolás' },
    ];

    assert.equal(canChoosePackaging(choppedChicken, 6), true);

    assert.equal(
        normalizePackageId({
            product: choppedChicken,
            quantity: 6,
            selectedPackageId: 2,
            packages,
        }),
        2
    );
});
