// Here we can override any settings from other configs (like .mocharc.yml etc.)
// Any of resulting settings can still be overriden by passing the values via CLI on testrun start
module.exports = {
    reporter: "spec",   // Consider to change it to "list" to get shorter form of report,
    // or any other reporter (s. https://www.w3resource.com/mocha/reporters.php)
    diff: true,         // Display diff on test failure
    slow: 150,          // Set treshold (ms) after that the test execution considered to be 'slow'
    spec: "build/test/**/*.js",
    // For the rest of settings see .mocharc.yml
};

// We don't really need this section. It is here just for fun (to get that fancy 'smiling cat' icon.)
// However, it may be useful for tuning of some other Mocha settings by monkey patching.
const {colors, symbols} = require('./node_modules/mocha/lib/reporters/base.js');
colors.pass = 32;
symbols.ok = '😸';