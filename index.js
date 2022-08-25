const Compiler = require('./snek');

const source = `a = [{}, { Snek, position: 0 }]`;

const compiler = new Compiler(source);

console.time('Parsing');
const [success, ast] = compiler.interpret();
console.timeEnd('Parsing');

if (success) {
    const Drawer = require('./drawer');

    const lines = new Drawer(source).draw(ast);

    console.log(lines);

    console.log(JSON.stringify(ast, null, 2));

} else
    console.error('Failed', compiler.errors);