const fs = require('fs');
const { asTree } = require('treeify');
const Compiler = require('./snek');

const source = fs.readFileSync('test.snek', 'utf-8');

const compiler = new Compiler(source);
// const Tokenizer = require('./tokenizer');

// const tokenizer = new Tokenizer(source);

// const stdout = process.stdout;
// for (let token = tokenizer.next(); token.type !== 'EndOfInput'; token = tokenizer.next()) {
//     if (token.type === 'NewLine')
//         stdout.write('\n');
//     else if (token.type === 'Indent')
//         stdout.write('=> ');
//     else if (token.type === 'Dedent')
//         stdout.write('<= ');
//     else {
//         const value = source.substring(token.position, token.position + token.length);
//         stdout.write(value + ' ');
//     }
// }

console.time('Parsing');
const [success, ast] = compiler.interpret();
console.timeEnd('Parsing');

if (success) {
    console.log(asTree(ast, true, true));
} else {
    console.error('Failed');
    console.error(asTree(compiler.errors, true, true));
}