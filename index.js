// import { parseArgs } from "node:util";
import * as fs from 'fs';
import treeify from 'treeify';
const { asTree } = treeify;

// import Snek from './snek.js';

// const { values: { tokenize, ast } } = parseArgs({ options: { tokenize: { type: 'boolean' }, ast: { type: 'boolean' } } });

const source = fs.readFileSync('test.snek', 'utf-8');

// const snek = new Snek(source);

// if (tokenize) {
//     const getValue = ({ position, length }) => JSON.stringify(source.substring(position, position + length));

//     const tokenizer = snek.tokenizer;
//     const write = str => process.stdout.write(str);

//     let token;
//     do {
//         token = tokenizer.next().value;
//         if (token.type === 'NewLine')
//             write('\n');
//         else if (token.type === 'Indent')
//             write('{\n');
//         else if (token.type === 'Dedent')
//             write('}\n');
//         else if (token.type === 'EndOfInput')
//             write('[EOI]\n\n');
//         else
//             write(getValue(token) + ' ');
//     } while (token.type !== 'EndOfInput');
// }

// if (ast) {
//     snek.execute(false);

//     console.log(asTree(snek.ast, true, true));

//     if (snek.errors.length > 0) {
//         console.error('Failed');
//         console.error(asTree(snek.errors, true, true));
//     }
// }

// //import { readFileSync } from 'fs';

// //const source = readFileSync('test.snek', 'utf-8');

// //const write = msg => process.stdout.write(msg);

// //for (const token of tokenize({ source })) {
// //    if (token.type === 'NewLine')
// //        write('\n');
// //    else if (token.type === 'Indent')
// //        write('{\n');
// //    else if (token.type === 'Dedent')
// //        write('}\n');
// //    else
// //        write('[' + token.type + ', ' + JSON.stringify(source.substring(token.position, token.position + token.length)) + ']');
// //}


import { tokenize } from './tokenizer.js';
import { parse } from './parser.js';
import { interpret } from './interpreter.js';

const state = {
    errors: [],
    source,
    addError(message, { position, length }) { state.errors.push({ message, position, length }); }
};

for (const token of tokenize(state))
    console.log(token);

state.tokenizer = tokenize(state);

const ast = parse(state);

if (state.errors.length > 0)
    console.log(asTree(state.errors, true, true));
else {
    console.log(asTree(ast, true, true));

    interpret(ast);
}


