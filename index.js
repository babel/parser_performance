const babylonParse = require("@babel/parser").parse;
const acornParse = require("acorn").parse;
const esprimaParse = require("esprima").parse;
const cherowParse = require("cherow").parse;
const fs = require("fs");
const Table = require("cli-table");
const Benchmark = require("benchmark");

/* START CONFIG */

const files = [
  "./fixtures/ember.debug.js",
  "./fixtures/jquery.js",
  "./fixtures/angular.js",
  "./fixtures/babylon-dist.js",
  "./fixtures/backbone.js",
  "./fixtures/react-with-addons.js"
];

const plugins = [
  "doExpressions",
  "objectRestSpread",
  ["decorators", { decoratorsBeforeExport: true }],
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
  "flow"
  //"estree"
];

const parsers = {
  acorn: acornParse,
  babylon: babylonParse,
  cherow: cherowParse,
  esprima: esprimaParse
};

/* END CONFIG */

console.log(`Node: ${process.version}`);

const head = ["fixture"];
for (let i in parsers) {
  head.push(i);
}

function test(parse, plugins, input, iterations) {
  for (let i = 0; i < iterations; i++) {
    parse(input, {
      sourceType: "script",
      //plugins: plugins,

      // acorn
      locations: true,
      onComment: () => {},

      // esprima
      loc: true,
      comment: true
    });
  }
}

const table = new Table({
  head,
  style: {
    head: ["bold"]
  }
});

// warmup cache
files.forEach(file => {
  const code = fs.readFileSync(file, "utf-8");
  for (let i in parsers) {
    test(parsers[i], i === "babylon" ? plugins : {}, code, 1);
  }
});

files.forEach(file => {
  if (global.gc) {
    global.gc();
  } else {
    console.warn(
      "Garbage collection unavailable.  Pass --expose-gc " +
        "when launching node to enable forced garbage collection."
    );
  }
  const code = fs.readFileSync(file, "utf-8");
  const suite = new Benchmark.Suite(file.replace(/\.\/fixtures\//, ""));
  for (let i in parsers) {
    const parser = parsers[i];
    const options = {
      sourceType: "script",
      //plugins: i === 'babylon' ? plugins: {},

      // acorn
      locations: true,
      onComment: () => {},

      // esprima
      loc: true,
      comment: true
    };

    suite.add(
      i,
      () => {
        parser(code, options);
      }
    );
  }
  const result = [suite.name];
  suite.on("cycle", function(event) {
    const bench = event.target;
    const factor = bench.hz < 100 ? 100 : 1;
    const msg = `${Math.round(bench.hz * factor) /
      factor} ops/sec ±${Math.round(bench.stats.rme * 100) /
      100}% (mean ${Math.round(bench.stats.mean * 1000)}ms)`;
    result.push(msg);
  });

  console.log(`Running test suite for ${suite.name} ...`);
  suite.run({ async: false });
  table.push(result);
});

console.log(table.toString());
