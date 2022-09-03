import fs from 'fs';

const tokenizer = fs.readFileSync('./tokenizer.js', 'utf-8');
const parser = fs.readFileSync('./parser.js', 'utf-8');
const interpreter = fs.readFileSync('./interpreter.js', 'utf-8');

const whole = [tokenizer, parser, interpreter].join('\n');

fs.writeFileSync('snek.js', whole);

console.log('Wrote', whole.split('\n').length, 'lines.');
