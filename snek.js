const regex = /( +)|(\r?\n)|([a-zA-Z_][\w]*)|([0-9]+(\.[0-9]+)?)|("(\\"|[^"])*?")|(\()|(\))|(\[)|(\])|(\{)|(\})|(\.)|(,)|(=)|(;)|(:)|(<=)|(<)|(>=)|(>)|(\+=)|(\+)|(-=)|(-)|(\*=)|(\*)|(\/=)|(\/)|(#[^\n]*\r?(\n|(?!.)))|(.)/g;
const TokenTypes = ['Space', 'NewLine', 'Identifier', 'Number', null, 'String', null, 'LeftParens', 'RightParens', 'LeftSquare', 'RightSquare', 'LeftCurly', 'RightCurly', 'Dot', 'Comma', 'Equal', 'Semicolon', 'Colon', 'LeftAngleEqual', 'LeftAngle', 'RightAngleEqual', 'RightAngle', 'PlusEqual', 'Plus', 'DashEqual', 'Dash', 'StarEqual', 'Star', 'SlashEqual', 'Slash', 'Comment', null, 'Error'];
const keywords = new Map(['and', 'break', 'continue', 'def', 'else', 'False', 'if', 'is', 'None', 'not', 'or', 'return', 'True', 'while'].map(k => [k, k.charAt(0).toUpperCase() + k.substring(1)]));

export function* tokenize(state) {
    const _token = (id, position, text) => {
        const type = (id === 2 ? keywords.get(text) ?? 'Identifier' : TokenTypes[id]) ?? 'Error';
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

class SyntaxError extends Error { constructor(msg, token) { super(msg); this.token = token; } }

export function parse(state) {
    let currentToken = null;
    const _node = (type, ...children) => ({ type, children });
    const _throw = (msg, token) => { throw new SyntaxError(msg, token); };
    const _defer = (f, r) => { f(); return r; };
    const _isEOI = () => currentToken.type === 'EndOfInput';
    const _getValue = ({ position, length }) => state.source.substring(position, position + length);
    const _advance = () => currentToken = state.tokenizer.next().value ?? _node('EndOfInput');
    const _match = (...types) => types.includes(currentToken.type) ? _defer(_advance, currentToken) : null;
    const _expect = (...types) => _match(...types) ?? _throw(`[Syntax] Expected ${types}, found ${currentToken.type}`, currentToken);
    const _switchMatch = (fail, ...typeFuncs) => {
        for (const [types, func] of typeFuncs)
            if (types.includes(currentToken.type)) {
                const token = currentToken;
                _advance();
                return func(token);
            }
        return fail();
    };
    const _parseBinary = (operators, func) => {
        let [left, token] = [func(), currentToken];
        while (operators.includes(token.type)) {
            _advance();
            [left, token] = [_node(token.type, left, func()), currentToken];
        }
        return left;
    };

    const _parseExpressionList = () => {
        const list = [_parseExpression()];
        while (_match('Comma'))
            list.push(_parseExpression());
        return list;
    };

    const _parseArray = () => {
        if (_match('RightSquare')) return _node('Array');
        return _node('Array', ..._defer(() => _expect('RightSquare'), _parseExpressionList()));
    };

    const _parseObject = () => {
        const node = _node('Object');
        if (_match('RightCurly')) return node; //Empty object

        while (true) {
            const key = _expect('Identifier');

            if (_match('Colon')) {
                const expr = _parseExpression();
                node.children.push([_getValue(key), expr]);
            } else //Yuck
                node.children.push([_getValue(key), _node('Identifier', _getValue(key))]);

            if (_match('RightCurly')) return node;

            _expect('Comma');
        }
    };

    const _parseParenthesizedExpression = () => _defer(() => _expect('RightParens'), _parseExpression());

    const _parsePrimary = () => _switchMatch(
        () => _throw(`[Syntax] Expected a primary expression: Number, String, Identifier, True, False, Array literal, Object literal or None, but found ${currentToken.type}`, currentToken),
        [['LeftParens'], _parseParenthesizedExpression],
        [['Number', 'Identifier', 'True', 'False', 'None'], token => _node(token.type, _getValue(token))],
        [['String'], token => _node('String', JSON.parse(_getValue(token)))],
        [['LeftSquare'], _parseArray],
        [['LeftCurly'], _parseObject],
    );

    const _parseMemberOrCall = () => {
        let node = _parsePrimary();
        while (true) {
            const r = _switchMatch(() => false,
                [['Dot'], () => _node('Index', node, _node('String', _getValue(_expect('Identifier'))))],
                [['LeftSquare'], () => _defer(() => _expect('RightSquare'), _node('Index', node, _parseExpression()))],
                [['LeftParens'], () => {
                    return _match('RightParens')
                        ? _node('Call', node)
                        : _defer(() => _expect('RightParens'), _node('Call', node, _parseExpressionList()));
                }]
            );

            if (r) node = r;
            else break;
        }
        return node;
    };

    const _parsePrefix = () => _switchMatch(
        () => _parseMemberOrCall(),
        [['Not', 'Dash'], token => _node(`Unary${token.type}`, _parsePrefix())]
    );

    const _parseMultiplication = () => _parseBinary(['Star', 'Slash'], _parsePrefix);

    const _parseAddition = () => _parseBinary(['Plus', 'Dash'], _parseMultiplication);

    const _parseComparison = () => {
        return _parseBinary(['LeftAngle', 'RightAngle', 'LeftAngleEqual', 'RightAngleEqual'], _parseAddition);
    };

    const _parseEquality = () => {
        let left = _parseComparison();
        while (_match('Is'))
            left = _node(_match('Not') ? 'IsNot' : 'Is', left, _parseComparison());
        return left;
    };

    const _parseBoolAnd = () => _parseBinary(['And'], _parseEquality);

    const _parseBoolOr = () => _parseBinary(['Or'], _parseBoolAnd);

    const _parseAssignment = () => _parseBinary(['Equal', 'PlusEqual', 'DashEqual', 'SlashEqual', 'StarEqual'], _parseBoolOr);

    const _parseExpression = () => _parseAssignment();

    const _internalParseBlock = isInline => {
        const statements = [];
        if (!isInline) _expect('Indent');
        while (!_isEOI() && (isInline || !_match('Dedent'))) {
            const statement = _parseStatement(isInline);
            if (statement.type !== 'Empty') statements.push(statement);
            if (isInline)
                if (_match('NewLine')) break;
                else _expect('Semicolon');
        }
        return _node('Block', ...statements);
    };

    const _parseBlock = () => _internalParseBlock(!_match('NewLine'));

    const _parseDef = () => {
        const [name, _] = [_node('Identifier', _getValue(_expect('Identifier'))), _expect('LeftParens')];

        const params = [];
        if (!_match('RightParens'))
            while (true) {
                params.push(_node('Param', _getValue(_expect('Identifier')), _match('Equal') ? _parseExpression() : undefined));

                if (_match('RightParens')) break;
                else _expect('Comma');
            }

        _expect('Colon');
        return _node('Def', name, params, _parseBlock());
    };

    const _parseIf = () => {
        let [condition, _, then, _else] = [_parseExpression(), _expect('Colon'), _parseBlock()];

        if (_match('Else')) {
            _else = _switchMatch(() => _throw(`[Syntax] Expected Colon or another If, but found ${currentToken.type}`, currentToken),
                [['If'], _parseIf],
                [['Colon'], _parseBlock]
            );
        }

        return _node('If', condition, then, _else);
    };

    const _parseWhile = () => {
        const [condition, _, body] = [_parseExpression(), _expect('Colon'), _parseBlock()];
        return _node('While', condition, body);
    };

    const _parseReturn = isInline => _node('Return', _parseExpressionStatement(isInline));

    const _parseExpressionStatement = (isInline) => _defer(
        () => { if (!isInline && !_isEOI()) _expect('NewLine', 'Semicolon', 'Dedent'); },
        _parseExpression()
    );

    const _parseStatement = (isInline = false) => _switchMatch(
        () => _parseExpressionStatement(isInline),
        [['NewLine'], () => _node('Empty')],
        [['Indent'], () => _internalParseBlock(false)],
        [['Def'], () => _parseDef()],
        [['If'], () => _parseIf()],
        [['While'], () => _parseWhile()],
        [['Return'], () => _parseReturn(isInline)],
        [['Break'], () => _node('Break')],
        [['Continue'], () => _node('Continue')],
    );

    //Actual parse function
    _advance();

    const statements = [];
    while (!_isEOI()) {
        try {
            const node = _parseStatement();
            if (node.type !== 'Empty') statements.push(node);
        } catch (e) {
            //Find a better way to sync on panic
            currentToken = _node('EndOfInput');
            state.addError(e.message, e.token);
        }
    }

    return _node('Program', ...statements);
}

export class Variable { constructor(scope, value) { this.scope = scope; this.value = value; } }

export function interpret(nodes, initial) {
    let scope = 0; let variables = new Map(initial);
    const _scope = f => {
        scope += 1;
        const r = f();
        for (const [k, v] of variables.entries())
            if (v.scope === scope) variables.delete(k);
        scope -= 1;
        return r;
    };
    const _get = k => variables.has(k) ? variables.get(k).value : null;
    const _set = (k, v) => {
        if (variables.has(k)) variables.get(k).value = v;
        else variables.set(k, new Variable(scope, v));
        return v;
    };
    const _isTruthy = v => !(v === false || v === null);

    const _runBlock = (node) => _scope(() => {
        for (const statement of node.children)
            if (statement.type === 'Return') return walk(statement);
            else walk(statement);
    });

    const _runFunctionDef = node => _set(node.children[0].children[0], node);

    const _runFunctionCall = node => {
        const [funcNode, argList] = node.children;
        const args = (argList ?? []).map(a => walk(a));

        const func = walk(funcNode);
        if (typeof (func) === 'function') func(...args);
        else return _scope(() => {
            const [_, params, block] = func.children;
            for (let i = 0; i < params.length; i += 1) {
                const [k, d] = params[i].children;
                const value = args[i] ?? walk(d);
                _set(k, value);
            }
            return _runBlock(block);
        });
    };

    const _runIdentifier = node => _get(node.children[0]);

    const _doBinaryOperation = (type, left, right) => {
        switch (type) {
            case 'Is': return left === right;
            case 'IsNot': return left !== right;
            case 'LeftAngle': return left < right;
            case 'RightAngle': return left > right;
            case 'LeftAngleEqual': return left <= right;
            case 'RightAngleEqual': return left >= right;
            case 'Plus': case 'PlusEqual': return left + right;
            case 'Dash': case 'DashEqual': return left - right;
            case 'Star': case 'StarEqual': return left * right;
            case 'Slash': case 'SlashEqual': return left / right;
            default:
                throw new Error('what');
        }
    };

    const _runBinaryOp = ({ type, children: [a, b] }) => _doBinaryOperation(type, walk(a), walk(b));

    const _runIf = node => {
        const [condition, _then, _else] = node.children;
        if (_isTruthy(walk(condition))) walk(_then);
        else if (_else) walk(_else);
    };

    const _runWhile = node => {
        const [condition, body] = node.children;

        while (_isTruthy(walk(condition)))
            walk(body);
    };

    const _runReturn = node => walk(node.children[0]);

    const _getObject = ({ children: [left, right] }) => walk(left)[walk(right)];

    const _runAssign = ({ type, children: [left, right] }) => {
        const rvalue = walk(right);
        if (left.type === 'Identifier') {
            const k = left.children[0];
            if (type === 'Equal') return _set(k, rvalue);
            return _set(k, _doBinaryOperation(type, _get(k), rvalue));
        } else if (left.type === 'Index') {
            const [obj, key] = [walk(left.children[0]), walk(left.children[1])];
            if (type === 'Equal') return obj[key] = rvalue;
            return obj[key] = _doBinaryOperation(type, obj[key], rvalue);
        }
    };

    const _runArray = ({ children }) => children.map(node => walk(node));

    const _runObject = ({ children }) => Object.fromEntries(children.map(([k, v]) => [k, walk(v)]));

    //Main walk function
    const walk = node => {
        try {
            switch (node.type) {
                case 'Def': return _runFunctionDef(node);
                case 'Call': return _runFunctionCall(node);
                case 'If': return _runIf(node);
                case 'While': return _runWhile(node);
                case 'Return': return _runReturn(node);
                case 'Block': return _runBlock(node);
                case 'Equal':
                case 'PlusEqual': case 'DashEqual':
                case 'StarEqual': case 'SlashEqual':
                    return _runAssign(node);
                case 'Index': return _getObject(node);
                case 'Is': case 'IsNot':
                case 'RightAngle': case 'LeftAngle':
                case 'RightAngleEqual': case 'LeftAngleEqual':
                case 'Plus': case 'Dash':
                case 'Slash': case 'Star':
                    return _runBinaryOp(node);
                case 'Identifier': return _runIdentifier(node);
                case 'String': return node.children[0];
                case 'Number': return parseFloat(node.children[0]);
                case 'True': return true;
                case 'False': return false;
                case 'None': return null;
                case 'Array': return _runArray(node);
                case 'Object': return _runObject(node);
                default:
                    console.log(node.type);
                // throw new Error(`Unexpected AST node = "${JSON.stringify(node)}"`);
            }

        } catch (error) {
            console.error('Encountered an error when executing your program.', error);
        }
    };

    //Actual execution loop
    _runBlock(nodes);
}

class Snek {
    constructor(source) {
        this.source = source;
        this.errors = [];
        this.tokenizer = tokenize(this);
    }

    addError(message, { position, length }) {
        this.errors.push({ message, position, length });
    }
}

export function run(source) {
    const state = new Snek(source);

    const program = parse(state);

    interpret(program, [
        ['print', new Variable(-1, (...args) => console.log(...args))]
    ]);
}

import fs from 'fs';

const source = fs.readFileSync(process.argv[2], 'utf-8');
run(source);