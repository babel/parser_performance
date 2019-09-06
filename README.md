# parser_performance

> Parses various [fixtures](/fixtures) and outputs parse times over various iterations

## Run

### build a production release of babel-parser
```
cd babel
NODE_ENV=production BABEL_ENV=production gulp build-rollup
```

### Run parser performance
It is recommended to clone `parser_performance` next to `babel` repository
```sh
git clone git@github.com:babel/parser_performance.git
yarn
yarn run test // performance test
yarn run memory // memory usage test
```

## Performance PRs

Check the [performance](https://github.com/babel/babel/issues?utf8=%E2%9C%93&q=label%3A"area%3A+perf"%20is%3Aboth) label in the babel repo for some examples.

## Performance Test
```sh
# Run performance test on ember.js fixture and compared to acorn parser
FILE=ember PARSER=acorn,dev yarn run test

# Specify a custom babel parser path and run performance test on all files
BABEL_PARSER_PATH=relative/path/from/parser_performance/to/babel-parser yarn run test
```
## Perf Tips

Microbenchmarks don't help that much, should test the real thing? (Also I don't know what I'm talking about)

- Caching, `Set.has` vs. `[].indexOf(val)`, hoisting, GC issues
- Make sure node shapes are the same (should be automated) https://github.com/babel/notes/issues/9

## Checking Performance

### Install/Use Node 12

```sh
nvm use 12
node -v
```

### Install NIM

> https://chrome.google.com/webstore/detail/nodejs-v8-inspector-manag/gnhhdgbaldcilmgcpfddgdbkhjohddkj?hl=en

It's a chrome Extension that helps automatically open the devtools when running --inspect

### Using `node --prof`

> https://nodejs.org/en/docs/guides/simple-profiling/

```sh
node --prof script.js
node --prof-process isolate*.log
# node --prof-process isolate*.log > out.txt
```

With @babel/parser:

```sh
node --prof ./node_modules/@babel/parser/bin/babel-parser.js fixtures/es5/ember.debug.js > /dev/null
node --prof-process isolate*.log
```

### Use `node --trace-opt`

```sh
node --trace-opt script.js | grep myFunc
node --trace-opt ./node_modules/@babel/parser/bin/babel-parser.js fixtures/es5/ember.debug.js
```

### Use `node --inspect-brk`

> https://medium.com/@paul_irish/debugging-node-js-nightlies-with-chrome-devtools-7c4a1b95ae27

Point node to the @babel/parser script and pass in a file to parse

> In this case I am running node in `parser` with `parser_performance/` in sibling folder

```sh
cd parser

# node --inspect-brk script.js
node --inspect-brk ./bin/babel-parser.js ../parser_performance/fixtures/es5/angular.js
```

If you have install NIM, it should open up chrome and show this view: (if not you can open the url shown in the console yourself)

![Imgur](http://i.imgur.com/i7YIyrH.png)

Then click on the "Profiler" Tab

![Imgur](http://i.imgur.com/MI0IrZ9.png)

Then click "Start"

![Imgur](http://i.imgur.com/XGKKjRy.png)

Wait a little bit and click "Stop", and you will be redirect to this screen

![Imgur](http://i.imgur.com/9wYUfXV.png)

## Some Links

- https://jsperf.com/
- https://esbench.com/bench
- https://github.com/vhf/v8-bailout-reasons
- https://community.risingstack.com/how-to-find-node-js-performance-optimization-killers/
- https://github.com/GoogleChrome/devtools-docs/issues/53
- https://gist.github.com/kevincennis/0cd2138c78a07412ef21
