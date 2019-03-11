exports.test = function test(parse, options, input, iterations) {
  for (let i = 0; i < iterations; i++) {
    parse(input, options);
  }
};
