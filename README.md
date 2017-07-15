# babylon_performance

> Parses various [fixtures](/fixtures) and outputs parse times over various iterations

## Run

```sh
npm install
npm t
```

## Performance PRs

Check the [performance](https://github.com/babel/babylon/issues?utf8=%E2%9C%93&q=label%3Aperformance%20is%3Aboth) label in the babylon repo for some examples.

## Checking for performance issues

### Install/Use Node 8

> Node 8 has a weird UI bug with Profiling atm, so switch to Node 6/7? https://twitter.com/drewml/status/881564816208527364

```sh
nvm use 8
node -v
```

### Install NIM

> https://chrome.google.com/webstore/detail/nodejs-v8-inspector-manag/gnhhdgbaldcilmgcpfddgdbkhjohddkj?hl=en

It's a chrome Extension that helps automatically open the devtools when running --inspect

### Use `node --inspect-brk`

> https://medium.com/@paul_irish/debugging-node-js-nightlies-with-chrome-devtools-7c4a1b95ae27

Point node to the babylon script and pass in a file to parse

```sh
# node --inspect-brk script.js
node --inspect-brk ./bin/babylon.js ../babylon_performance/fixtures/angular.js
```

If you have install NIM, it should open up chrome and show this view: (if not you can open the url shown in the console yourself)

![Imgur](http://i.imgur.com/i7YIyrH.png)

Then click on the "Profiler" Tab

![Imgur](http://i.imgur.com/MI0IrZ9.png)

Then click "Start"

![Imgur](http://i.imgur.com/XGKKjRy.png)

Wait a little bit and click "Stop", and you will be redirect to this screen

![Imgur](http://i.imgur.com/9wYUfXV.png)
