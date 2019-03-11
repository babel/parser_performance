const fs = require("fs");
const Table = require("cli-table");
const { parsers, files } = require("./config");
const { test } = require("./util");

/* START CONFIG */
const iterations = 5;
/* END CONFIG */

console.log(`Node: ${process.version}`);

const head = ["fixture"];
for (let i in parsers) {
  head.push(`${i} x${iterations}`);
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
  const name = file.replace(/\.\/fixtures\//, "");
  console.log(`Running benchmark for ${name} ...`);
  const code = fs.readFileSync(file, "utf-8");
  const result = [name];
  for (let i in parsers) {
    const { parse, options } = parsers[i];

    // warmup
    test(parse, options, code, 1);
    global.gc();
  }
  for (let i in parsers) {
    const { parse, options } = parsers[i];

    global.gc();
    let oldSize = process.memoryUsage();

    test(parse, options, code, iterations);

    const memory = process.memoryUsage();
    const heapUsed = memory.heapUsed - oldSize.heapUsed;
    const msg = `heap: ${Math.round((heapUsed / 1024 / 1024) * 100) / 100} MiB`;
    result.push(msg);
    global.gc();
  }
  table.push(result);
});

console.log(table.toString());
