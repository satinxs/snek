import * as fs from 'fs';
import treeify from 'treeify';
const { asTree } = treeify;
import argParser from 'args-parser';

const args = argParser(process.argv);

const source = fs.readFileSync('test.snek', 'utf-8');

import { tokenize } from './tokenizer.js';
import { parse } from './parser.js';
import { interpret, Variable } from './interpreter.js';

const tokenizer = fs.readFileSync('./tokenizer.js', 'utf-8');
const parser = fs.readFileSync('./parser.js', 'utf-8');
const interpreter = fs.readFileSync('./interpreter.js', 'utf-8');

const whole = [tokenizer, parser, interpreter].join('\n').split('\n');

console.log('snek has a total of:', whole.length, 'lines');

const state = {
    errors: [],
    source,
    addError(message, { position, length }) { state.errors.push({ message, position, length }); }
};

if (args.tokens) {
    console.log('Tokens:');

    const write = msg => process.stdout.write(msg);
    const keywords = new Set(['And', 'Break', 'Continue', 'Def', 'Else', 'False', 'If', 'Is', 'None', 'Not', 'Or', 'Return', 'True', 'While']);
    const getValue = ({ position, length }, escape = true) => escape ? JSON.stringify(source.substring(position, position + length)) : source.substring(position, position + length);
    for (const token of tokenize(state)) {
        if (token.type === 'NewLine')
            write('\\n\n');
        else if (token.type === 'Semicolon' || token.type === 'LineEnd')
            write('<endl>\n');
        else if (token.type === 'Indent')
            write('{\n');
        else if (token.type === 'Dedent')
            write('}\n');
        else if (token.type === 'EndOfInput')
            write('\n[EOI]\n\n');
        else if (token.type === 'Identifier')
            write('i' + getValue(token) + ' ');
        else if (token.type === 'Number')
            write('n' + getValue(token) + ' ');
        else if (keywords.has(token.type))
            write(token.type + ' ');
        else
            write(getValue(token, false) + ' ');
    }
}

state.tokenizer = tokenize(state);

state.ast = parse(state);

//TODO: This is buggy, fix it!
const calculatePosition = ({ position }) => {
    const lines = source.split('\n');
    let pos = 0;
    let lineIndex = 0;
    for (; lineIndex < lines.length; lineIndex += 1) {
        const line = lines[lineIndex];

        if (pos < position)
            pos += line.length;
        else break;
    }

    return { line: lineIndex, column: pos - position };
};

if (state.errors.length > 0) {
    for (const error of state.errors)
        console.error(`Error at ${error.position} ${JSON.stringify(calculatePosition(error))} = ${error.message}`);
}
else {
    if (args.ast) {
        console.log('\n\nNodes:');
        console.log(asTree(state.ast, true, true));
    }
}

if (args.run) {
    interpret(state.ast, [
        ['print', new Variable(-1, (...args) => console.log(...args))],
        ['fs', new Variable(-1, fs)]
    ]);
}
