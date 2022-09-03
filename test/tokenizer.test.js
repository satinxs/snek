import assert from 'assert';
import * as  Tokenizer from '../tokenizer.js';

const keywords = Object.fromEntries(['and', 'break', 'continue', 'def', 'else', 'False', 'if', 'is', 'None', 'not', 'or', 'return', 'True', 'while'].map(k => [k, k.charAt(0).toUpperCase() + k.substring(1)]));

const createToken = (type, position, length) => ({ type, position, length });

const EndOfInput = { type: 'EndOfInput' };

const tokenizeAll = source => {
    const tokenizer = Tokenizer.tokenize({ source, addError(msg) { throw new Error(msg); } });
    const tokens = [];
    for (const token of tokenizer)
        tokens.push(token);
    return tokens;
};

describe('Snek Compiler', () => {
    describe('#tokenize()', () => {
        it('appends EndOfInput at the end of the token stream', () => {
            assert.deepEqual(tokenizeAll(''), [EndOfInput]);
        });

        describe('Number', () => {
            it('parses a single digit as number', () => {
                const digits = '0123456789';

                for (const digit of digits)
                    assert.deepEqual(tokenizeAll(digit), [createToken('Number', 0, 1), EndOfInput]);
            });

            it('parses a negated digit as number', () => {
                const digits = '0123456789';

                for (const digit of digits)
                    assert.deepEqual(tokenizeAll('-' + digit), [createToken('Number', 0, 2), EndOfInput]);
            });

            it('parses a decimal number', () => {
                assert.deepEqual(tokenizeAll('0.0'), [createToken('Number', 0, 3), EndOfInput]);
                assert.deepEqual(tokenizeAll('1.23'), [createToken('Number', 0, 4), EndOfInput]);
            });

            it('parses a negated decimal number', () => {
                assert.deepEqual(tokenizeAll('-0.0'), [createToken('Number', 0, 4), EndOfInput]);
                assert.deepEqual(tokenizeAll('-1.23'), [createToken('Number', 0, 5), EndOfInput]);
            });
        });

        describe('Identifier', () => {
            it('parses a single letter as identifier', () => {
                const letters = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

                for (const letter of letters)
                    assert.deepEqual(tokenizeAll(letter), [createToken('Identifier', 0, 1), EndOfInput]);
            });

            it('parses identifiers starting with a letter', () => {
                assert.deepEqual(tokenizeAll('abracadabra'), [createToken('Identifier', 0, 11), EndOfInput]);
                assert.deepEqual(tokenizeAll('zeta'), [createToken('Identifier', 0, 4), EndOfInput]);
            });

            it('parses identifiers starting with an underscore', () => {
                assert.deepEqual(tokenizeAll('_abracadabra'), [createToken('Identifier', 0, 12), EndOfInput]);
                assert.deepEqual(tokenizeAll('_zeta'), [createToken('Identifier', 0, 5), EndOfInput]);
            });

            it('parses keywords as such', () => {
                for (const [k, v] of Object.entries(keywords)) {
                    assert.deepEqual(tokenizeAll(k), [createToken(v, 0, k.length), EndOfInput]);
                }
            });
        });

        describe('Symbols', () => {
            it('parses single symbols', () => {
                const symbols = '()[]{}*/+-<>,.:;=';
                const symbolMap = ['LeftParens', 'RightParens', 'LeftSquare', 'RightSquare', 'LeftCurly', 'RightCurly', 'Star', 'Slash', 'Plus', 'Dash', 'LeftAngle', 'RightAngle', 'Comma', 'Dot', 'Colon', 'Semicolon', 'Equal'];

                for (let i = 0; i < symbols.length; i += 1)
                    assert.deepEqual(tokenizeAll(symbols[i]), [createToken(symbolMap[i], 0, 1), EndOfInput]);
            });

            it('parses double symbols', () => {
                const symbols = '<= >= += -= *= /='.split(' ');
                const symbolMap = ['LeftAngleEqual', 'RightAngleEqual', 'PlusEqual', 'DashEqual', 'StarEqual', 'SlashEqual'];

                for (let i = 0; i < symbols.length; i += 1)
                    assert.deepEqual(tokenizeAll(symbols[i]), [createToken(symbolMap[i], 0, 2), EndOfInput]);
            });
        });

        describe('Spaces', () => {
            it('ignores spaces between other tokens', () => {
                assert.deepEqual(tokenizeAll('a b'), [createToken('Identifier', 0, 1), createToken('Identifier', 2, 1), EndOfInput]);
                assert.deepEqual(tokenizeAll('1   b'), [createToken('Number', 0, 1), createToken('Identifier', 4, 1), EndOfInput]);
            });

            it('parses spaces at the beginning of the line as indentation', () => {
                assert.deepEqual(tokenizeAll('    a'), [createToken('Indent', 0, 4), createToken('Identifier', 4, 1), createToken('Dedent', 4, 4), EndOfInput]);
                assert.deepEqual(tokenizeAll('        -1.2'), [createToken('Indent', 0, 4), createToken('Indent', 1, 4), createToken('Number', 8, 4), createToken('Dedent', 11, 4), createToken('Dedent', 12, 4), EndOfInput]);
            });

            it('fails if indentation spaces are not multiple of 4', () => {
                assert.throws(() => tokenizeAll('   a'));
                assert.throws(() => tokenizeAll('      -1.2'));
            });

            it('parses newlines', () => {
                assert.deepEqual(tokenizeAll('\n'), [createToken('NewLine', 0, 1), EndOfInput]);
                assert.deepEqual(tokenizeAll('\n\n'), [createToken('NewLine', 0, 1), createToken('NewLine', 1, 1), EndOfInput]);
            });
        });
    });
});
