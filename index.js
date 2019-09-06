const fs = require("fs");
const Table = require("cli-table");
const Benchmark = require("benchmark");
const { parsers, files, benchmarkOptions } = require("./config");
const { test } = require("./util");

console.log(`Node: ${process.version}`);

const head = ["fixture"];
for (let i in parsers) {
  head.push(i);
}

const table = new Table({
  head,
  style: {
    head: ["bold"]
  }
});

if (!global.gc) {
  console.error(
    "Garbage collection unavailable.  Pass --expose-gc " +
      "when launching node to enable forced garbage collection."
  );
  process.exit();
}

files.forEach(file => {
  const code = fs.readFileSync(file, "utf-8");
  const suite = new Benchmark.Suite(file.replace(/\.\/fixtures\//, ""), benchmarkOptions);
  for (let i in parsers) {
    const { parse, options } = parsers[i];

    // warmup
    test(parse, options, code, 5);
    global.gc();
    suite.add(i, () => {
      parse(code, options);
    });
  }
  const result = [suite.name];
  suite.on("cycle", function(event) {
    {
      // separate scope so we can cleanup all this afterwards
      const bench = event.target;
      const factor = bench.hz < 100 ? 100 : 1;
      const timeMs = bench.stats.mean * 1000;
      const time = (timeMs < 10)? `${Math.round(timeMs*1000)/1000}ms` : `${Math.round(timeMs)}ms`;
      const msg = `${Math.round(bench.hz * factor) /
        factor} ops/sec ±${Math.round(bench.stats.rme * 100) /
        100}% (${time})`;
      result.push(msg);
    }
    global.gc();
  });

  console.log(`Running benchmark for ${suite.name} ...`);
  global.gc();
  suite.run({ async: false });
  global.gc(); // gc is disabled so ensure we run it
  table.push(result);
});
global.gc(); // gc is disabled so ensure we run it
console.log(table.toString());
