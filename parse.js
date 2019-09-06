const { parsers, files } = require("./config");
const fs = require("fs");
const parseRound = 5; 

files.forEach(file => {
  const code = fs.readFileSync(file, "utf-8");
  for (let i in parsers) {
    const { parse, options } = parsers[i];
    for (let j = 0; j < parseRound; j++) {
      parse(code, options);
    }
  }
});
