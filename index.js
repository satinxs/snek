import { parseArgs } from "node:util";
import * as fs from 'fs';

import treeify from 'treeify';
const { asTree } = treeify;

import Snek, { Tokenizer } from './snek.js';

const { values: { tokenize } } = parseArgs({ options: { tokenize: { type: 'boolean' } } });

const source = fs.readFileSync('test.snek', 'utf-8');

const snek = new Snek(source);

if (tokenize) {
    const getValue = ({ position, length }) => JSON.stringify(source.substring(position, position + length));

    const tokenizer = new Tokenizer(snek);
    const write = str => process.stdout.write(str);

    let token;
    do {
        token = tokenizer.next();
        if (token.type === 'NewLine')
            write('\n');
        else if (token.type === 'Indent')
            write('{\n');
        else if (token.type === 'Dedent')
            write('}\n');
        else if (token.type === 'EndOfInput')
            write('[EOI]\n\n');
        else
            write(getValue(token) + ' ');
    } while (token.type !== 'EndOfInput');
} else {
    snek.execute();

    if (snek.errors.length > 0) {
        console.error('Failed');
        console.error(asTree(snek.errors, true, true));
    }
}
