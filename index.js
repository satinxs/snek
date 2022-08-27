const fs = require('fs');
const { asTree } = require('treeify');
const Compiler = require('./snek');

const source = fs.readFileSync('test.snek', 'utf-8');

const compiler = new Compiler(source);

console.time('Parsing');
const [success, ast] = compiler.interpret();
console.timeEnd('Parsing');

if (success) {
    console.log(asTree(ast, true, true));
} else {
    console.error('Failed');
    console.error(asTree(compiler.errors, true, true));
}