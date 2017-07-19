const babylonParse = require('babylon').parse;
const acornParse = require('acorn').parse;
const esprimaParse = require('esprima').parse;
const fs = require('fs');
const Table  = require("cli-table");


/* START CONFIG */

const ITERATIONS = 20;

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

const parsers = {
  babylon: babylonParse,
  acorn: acornParse,
  esprima: esprimaParse
};

/* END CONFIG */

console.log(`Node: ${process.version}`);
console.log(`ITERATIONS: ${ITERATIONS}`);

const head = ["fixture"];
for (let i in parsers) {
  head.push(i);
}

function test(parse, plugins, input, iterations) {
  for (let i = 0; i < iterations; i++) {
    parse(input, {
      sourceType: "script",
      plugins: plugins
    });
  }
}

const table = new Table({
  head,
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

// warmup cache
files.forEach((file) => {
  const code = fs.readFileSync(file, 'utf-8');
  for (let i in parsers) {
    test(parsers[i], i === 'babylon' ? plugins: {}, code, 1);
  }
});

files.forEach((file) => {
  const code = fs.readFileSync(file, 'utf-8');
  const result = [ file ];
  for (let i in parsers) {
    const start = Date.now();
    test(parsers[i], i === 'babylon' ? plugins: {}, code, ITERATIONS);
    const avg = (Date.now() - start) / ITERATIONS;
    result.push(avg.toFixed(1) + "ms").padStart(7);
  }
  table.push(result);
});

console.log(table.toString());
