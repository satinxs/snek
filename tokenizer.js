const regex = /( +)|(\r?\n)|([a-zA-Z_][\w]*)|(-?[0-9]+(\.[0-9]+)?)|("(\\"|[^"])*?")|(\()|(\))|(\[)|(\])|(\{)|(\})|(\.)|(,)|(=)|(;)|(:)|(<=)|(<)|(>=)|(>)|(\+=)|(\+)|(-=)|(-)|(\*=)|(\*)|(\/=)|(\/)|(#[^\n]*\r?(\n|(?!.)))|(.)/g;
const TokenTypes = ['Space', 'NewLine', 'Identifier', 'Number', null, 'String', null, 'LeftParens', 'RightParens', 'LeftSquare', 'RightSquare', 'LeftCurly', 'RightCurly', 'Dot', 'Comma', 'Equal', 'Semicolon', 'Colon', 'LeftAngleEqual', 'LeftAngle', 'RightAngleEqual', 'RightAngle', 'PlusEqual', 'Plus', 'DashEqual', 'Dash', 'StarEqual', 'Star', 'SlashEqual', 'Slash', 'Comment', null, 'Error'];
const keywords = Object.fromEntries(['and', 'break', 'continue', 'def', 'else', 'False', 'if', 'is', 'None', 'not', 'or', 'return', 'True', 'while'].map(k => [k, k.charAt(0).toUpperCase() + k.substring(1)]));

export function* tokenize(state) {
    const _token = (id, position, text) => {
        const type = (id === 2 ? keywords[text] ?? 'Identifier' : TokenTypes[id]) ?? 'Error';
        return { type, position, length: text.length };
    };

    let isNewLine = true; let queue = []; let indentation = 0;

    const _processIndentation = (position, diff) => {
        if (diff % 4 !== 0) {
            state.addError(`[Lexical] Bad indentation: Indentation should be multiple of 4, found ${Math.abs(diff)}`, { position, length: Math.abs(diff) });
            return { type: 'Error', position, length: Math.abs(diff) };
        }

        for (let i = 0; i < Math.abs(diff) / 4; i += 1)
            queue.push({ type: diff < 0 ? 'Dedent' : 'Indent', position: position + i, length: 4 });

        indentation += diff;
    };

    for (const match of state.source.matchAll(regex)) {
        let id = 0;
        for (; id < match.length; id += 1)
            if (match[id + 1] !== undefined) break;

        const token = _token(id, match.index, match[0]);

        if (isNewLine && token.type === 'Space') _processIndentation(token.position, token.length - indentation);
        else if (isNewLine && token.type !== 'NewLine' && indentation > 0)
            _processIndentation(token.position, -indentation);

        while (queue.length > 0) yield queue.shift();

        if (!['Space', 'Comment'].includes(token.type))
            yield token;

        isNewLine = token.type === 'NewLine';
    }

    if (indentation > 0) _processIndentation(state.source.length - 1, -indentation);
    while (queue.length > 0) yield queue.shift();
    yield { type: 'EndOfInput' };
}
