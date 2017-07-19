const babylonParse = require('babylon').parse;
const acornParse = require('acorn').parse;
const esprimaParse = require('esprima').parse;
const fs = require('fs');
const Table  = require("cli-table");

console.log(`Node: ${process.version}`);

const ITERATIONS = 20;

function test(parse, plugins, input, iterations) {
  for (let i = 0; i < iterations; i++) {
    parse(input, {
      sourceType: "script",
      plugins: plugins
    });
  }
}

const files = [
  './fixtures/backbone.js',
  './fixtures/jquery.js',
  './fixtures/babylon-dist.js',
  './fixtures/angular.js',
  './fixtures/react-with-addons.js',
  './fixtures/ember.debug.js',
];

const plugins = [
  "doExpressions",
  "objectRestSpread",
  "decorators",
  "classProperties",
  "exportExtensions",
  "asyncGenerators",
  "functionBind",
  "functionSent",
  "dynamicImport",
  "numericSeparator",
  "optionalChaining",
  "importMeta",
  "bigInt",
  "jsx",
  "flow",
  // "estree"
];

const table = new Table({
  head: ["fixture", "babylon", "acorn", "esprima"],
  chars: {
    top: "",
    "top-mid": "" ,
    "top-left": "" ,
    "top-right": "",
    bottom: "" ,
    "bottom-mid": "" ,
    "bottom-left": "" ,
    "bottom-right": "",
    left: "",
    "left-mid": "",
    mid: "",
    "mid-mid": "",
    right: "" ,
    "right-mid": "",
    middle: " ",
  },
  style: {
    "padding-left": 0,
    "padding-right": 0,
    head: ["bold"],
  },
});

const results = [];

// warmup cache
files.forEach((file) => {
  const code = fs.readFileSync(file, 'utf-8');
  [babylonParse, acornParse, esprimaParse].forEach((parseFn, i) => {
    test(parseFn, i === 0 ? plugins: {}, code, 1);
  });
});

files.forEach((file) => {
  const code = fs.readFileSync(file, 'utf-8');
  const runs = [];
  [babylonParse, acornParse, esprimaParse].forEach((parseFn, i) => {
    const start = Date.now();
    test(parseFn, i === 0 ? plugins: {}, code, ITERATIONS);
    const end = Date.now();
    runs[i] = (end - start) / ITERATIONS;
  });
  results.push({ file, babylon: runs[0], acorn: runs[1], esprima: runs[2] });
});

results.forEach(function (result, i) {
  let row = [
    result.file,
    (result.babylon.toFixed(1) + "ms").padStart(7),
    (result.acorn.toFixed(1) + "ms").padStart(7),
  ];

  table.push(row);
});

console.log(table.toString());
