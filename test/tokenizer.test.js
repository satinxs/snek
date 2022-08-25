const assert = require('assert');
const { tokenize } = require('../snek');

const createToken = (type, position, length) => ({ type, position, length });

const EndOfInput = { type: 'EndOfInput' };

describe('Snek Compiler', () => {
    describe('#tokenize()', () => {
        it('appends EndOfInput at the end of the token stream', () => {
            assert.deepEqual(tokenize(''), [EndOfInput]);
        });

        describe('Number', () => {
            it('parses a single digit as number', () => {
                const digits = '0123456789';

                for (const digit of digits)
                    assert.deepEqual(tokenize(digit), [createToken('Number', 0, 1), EndOfInput]);
            });

            it('parses a negated digit as number', () => {
                const digits = '0123456789';

                for (const digit of digits)
                    assert.deepEqual(tokenize('-' + digit), [createToken('Number', 0, 2), EndOfInput]);
            });

            it('parses a decimal number', () => {
                assert.deepEqual(tokenize('0.0'), [createToken('Number', 0, 3), EndOfInput]);
                assert.deepEqual(tokenize('1.23'), [createToken('Number', 0, 4), EndOfInput]);
            });

            it('parses a negated decimal number', () => {
                assert.deepEqual(tokenize('-0.0'), [createToken('Number', 0, 4), EndOfInput]);
                assert.deepEqual(tokenize('-1.23'), [createToken('Number', 0, 5), EndOfInput]);
            });
        });

        describe('Identifier', () => {
            it('parses a single letter as identifier', () => {
                const letters = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

                for (const letter of letters)
                    assert.deepEqual(tokenize(letter), [createToken('Identifier', 0, 1), EndOfInput]);
            });

            it('parses identifiers starting with a letter', () => {
                assert.deepEqual(tokenize('abracadabra'), [createToken('Identifier', 0, 11), EndOfInput]);
                assert.deepEqual(tokenize('zeta'), [createToken('Identifier', 0, 4), EndOfInput]);
            });

            it('parses identifiers starting with an underscore', () => {
                assert.deepEqual(tokenize('_abracadabra'), [createToken('Identifier', 0, 12), EndOfInput]);
                assert.deepEqual(tokenize('_zeta'), [createToken('Identifier', 0, 5), EndOfInput]);
            });
        });

        describe('Symbols', () => {
            it('parses single symbols', () => {
                const symbols = '()[]{}*/+-<>,.:;=';
                const symbolMap = ['LeftParens', 'RightParens', 'LeftSquare', 'RightSquare', 'LeftCurly', 'RightCurly', 'Star', 'Slash', 'Plus', 'Dash', 'LeftAngle', 'RightAngle', 'Comma', 'Dot', 'Colon', 'Semicolon', 'Equal'];

                for (let i = 0; i < symbols.length; i += 1)
                    assert.deepEqual(tokenize(symbols[i]), [createToken(symbolMap[i], 0, 1), EndOfInput]);
            });

            it('parses double symbols', () => {
                const symbols = '<= >= += -= *= /='.split(' ');
                const symbolMap = ['LeftAngleEqual', 'RightAngleEqual', 'PlusEqual', 'DashEqual', 'StarEqual', 'SlashEqual'];

                for (let i = 0; i < symbols.length; i += 1)
                    assert.deepEqual(tokenize(symbols[i]), [createToken(symbolMap[i], 0, 2), EndOfInput]);
            });
        });

        describe('Spaces', () => {
            it('parses spaces', () => {
                assert.deepEqual(tokenize('   '), [createToken('Space', 0, 3), EndOfInput]);
                assert.deepEqual(tokenize(' '), [createToken('Space', 0, 1), EndOfInput]);
                assert.deepEqual(tokenize('        '), [createToken('Space', 0, 8), EndOfInput]);
            });

            it('parses tabs', () => {
                assert.deepEqual(tokenize('\t'), [createToken('Tab', 0, 1), EndOfInput]);
                assert.deepEqual(tokenize('\t\t'), [createToken('Tab', 0, 2), EndOfInput]);
                assert.deepEqual(tokenize('\t\t\t\t'), [createToken('Tab', 0, 4), EndOfInput]);
            });

            it('parses whitespaces', () => {
                assert.deepEqual(tokenize('\v\r'), [createToken('Whitespace', 0, 2), EndOfInput]);
                assert.deepEqual(tokenize('\r\r\r'), [createToken('Whitespace', 0, 3), EndOfInput]);
            });

            it('parses newlines', () => {
                assert.deepEqual(tokenize('\n'), [createToken('NewLine', 0, 1), EndOfInput]);
                assert.deepEqual(tokenize('\n\n'), [createToken('NewLine', 0, 1), createToken('NewLine', 1, 1), EndOfInput]);
            });
        });
    });
});
