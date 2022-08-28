//Utility functions
const escapeRegExp = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
const k = str => new RegExp(`^(${str})(?!\\w)`); //Keyword
const r = str => new RegExp('^' + escapeRegExp(str)); //Escaped regex

//Order of the TokenTypes is important.
const TokenTypes = {
    Def: k('def'), If: k('if'), Else: k('else'), While: k('while'), Import: k('import'), Return: k('return'),
    IsNot: k('is\\s+not'), Or: k('or'), And: k('and'), Is: k('is'), Not: k('not'),
    True: k('True'), False: k('False'), None: k('None'), Number: /^-?[0-9]+(\.[0-9]+)?/,
    LeftParens: r('('), RightParens: r(')'), LeftSquare: r('['), RightSquare: r(']'), LeftCurly: r('{'), RightCurly: r('}'),
    LeftAngleEqual: r('<='), RightAngleEqual: r('>='), StarEqual: r('*='), SlashEqual: r('/='), PlusEqual: r('+='), DashEqual: r('-='),
    Star: r('*'), Slash: r('/'), Plus: r('+'), Dash: r('-'), LeftAngle: r('<'), RightAngle: r('>'),
    Comma: r(','), Dot: r('.'), Colon: r(':'), Semicolon: r(';'), Equal: r('='),
    String: /^(['"])(.*?)\1/, Identifier: /^[a-zA-Z_][\w]*(?![\w])/,
    Space: /^ +/, NewLine: /^\r?\n/, Tab: /^\t+/, Whitespace: /^\s+/, Comment: /^#[^\n]*\r?(\n|(?!.))/,
    Error: /^./
};

const defer = (f, r) => { f(); return r; };

class Tokenizer {
    position = 0; indentation = 0;
    isNewLine = true; queue = [];

    constructor(source) {
        this.source = source;
        this.input = source;
    }

    _advance(l) { this.position += l; this.input = this.input.substring(l); }

    _token(type, length) { return defer(() => this._advance(length), { type, position: this.position, length }); }

    _next() {
        for (const [type, regex] of Object.entries(TokenTypes)) {
            const match = this.input.match(regex);

            if (match)
                return this._token(type, match[0].length);
        }
    }

    _processIndentation(position, diff) {
        const type = diff < 0 ? 'Dedent' : 'Indent';
        for (let i = 0; i < Math.abs(diff); i += 1)
            this.queue.push({ type, position, length: 1 });

        this.indentation += diff;
        this.isNewLine = false;

        return this.queue.pop();
    }

    next() {
        if (this.queue.length > 0) return this.queue.pop();
        if (this.input.length === 0) return { type: 'EndOfInput' };

        let token;
        while (token = this._next()) {
            if (this.isNewLine) {
                if (token.type === 'NewLine') continue;

                if (token.type === 'Space') {
                    if (this.indentation === token.length) continue;
                    return this._processIndentation(token.position, token.length - this.indentation);
                } else if (this.indentation > 0) {
                    this.queue.push(token);
                    return this._processIndentation(token.position, -this.indentation);
                }
            }

            this.isNewLine = token.type === 'NewLine';

            if (!['Space', 'Whitespace', 'Comment'].includes(token.type))
                return token;
        }
    }
}

class Compiler {
    errors = [];
    constructor(source) { this.source = source; }

    get isEOI() { return this.currentToken.type === 'EndOfInput'; }

    getValue({ position, length }) { return this.source.substring(position, position + length); }

    addError(message, { position, length }) { this.errors.push({ message, position, length }); }

    advance() { this.currentToken = this.tokenizer.next(); }

    match(...types) {
        const token = this.currentToken;

        if (types.includes(token.type)) {
            this.advance();
            return token;
        }

        return null;
    }

    check(...types) { return types.includes(this.currentToken.type) ? this.currentToken : null; }

    expect(...types) {
        const token = this.match(...types);

        if (!token) this.addError(`Expected ${types}, found ${this.currentToken.type}`, this.currentToken);

        return token;
    }

    parseParenthesizedExpression() {
        const expression = this.parseExpression();

        if (!this.expect('RightParens'))
            return [false];

        return expression;
    }

    parseBinary(operators, func) {
        let [success, left] = func();

        if (!success) return [false];

        let token = this.currentToken;
        while (operators.includes(token.type)) {
            this.advance();

            const [success, right] = func();

            if (!success) return [false];

            left = { type: token.type, left, right };
            token = this.currentToken;
        }

        return [true, left];
    }

    parseIdentifier() {
        const token = this.currentToken;

        if (!this.expect('Identifier')) return [false];

        return [true, { type: 'Identifier', value: this.getValue(token) }];
    }

    parseExpression() {
        const assignment = () => this.parseBinary(['Equal', 'PlusEqual', 'DashEqual', 'SlashEqual', 'StarEqual'], boolOr);
        const boolOr = () => this.parseBinary(['Or'], boolAnd);
        const boolAnd = () => this.parseBinary(['And'], equality);
        const equality = () => this.parseBinary(['Is', 'IsNot'], comparison);
        const comparison = () => this.parseBinary(['LeftAngle', 'RightAngle', 'LeftAngleEqual', 'RightAngleEqual'], addition);
        const addition = () => this.parseBinary(['Plus', 'Dash'], multiplication);
        const multiplication = () => this.parseBinary(['Star', 'Slash'], prefix);

        const prefix = () => {
            const token = this.match('Not', 'Dash');

            if (token) {
                const [success, expression] = prefix();

                if (!success) return [false];

                return [true, { type: `Unary${token.type}`, expression }];
            }

            return memberOrCall(); //If prefix was not matched, we return the next in the expression chain
        };

        const memberOrCall = () => {
            let [success, node] = parsePrimary();

            if (!success) return [false];

            while (true) {
                if (this.match('Dot')) {
                    const [success, identifier] = this.parseIdentifier();

                    if (!success) return [false];

                    node = { type: 'Member', left: node, right: identifier };
                } else if (this.match('LeftSquare')) {
                    const [success, expression] = this.parseExpression();

                    if (!success) return [false];

                    if (!this.expect('RightSquare')) return [false];

                    node = { type: 'Index', left: node, right: expression };
                } else if (this.match('LeftParens')) {
                    const callNode = { type: 'Call', func: node, args: [] };

                    if (!this.match('RightParens')) {
                        const [success, args] = parseExpressionList();

                        if (!success) return [false];

                        callNode.args = args;

                        if (!this.expect('RightParens')) return [false];
                    }

                    node = callNode;
                }
                else break;
            }

            return [true, node];
        };

        //Warning, returns a list, not a node
        const parseExpressionList = () => {
            const [success, expr] = this.parseExpression();

            if (!success) return [false];

            const list = [expr];
            while (this.match('Comma')) {
                const [success, expr] = this.parseExpression();

                if (!success) return [false];

                list.push(expr);
            }

            return [true, list];
        };

        const parseArray = () => {
            if (this.match('RightSquare'))
                return [true, { type: 'Array', values: [] }];

            const [success, list] = parseExpressionList();

            if (!success) return [false];

            if (!this.expect('RightSquare')) return [false];

            return [true, { type: 'Array', values: list }];
        };

        const parseObject = () => {
            const node = { type: 'Object', props: [] };

            if (this.match('RightCurly'))
                return [true, node];

            while (true) {
                const key = this.match('Identifier');

                if (!key) return [false];

                const value = this.getValue(key);

                if (this.match('Colon')) {
                    const [success, expr] = this.parseExpression();

                    if (!success) return [false];

                    node.props.push([value, expr]);
                } else
                    node.props.push([value, { type: 'String', value }]);

                if (this.match('RightCurly')) return [true, node];

                if (!this.expect('Comma')) return [false];
            }
        };

        const parsePrimary = () => {
            const token = this.currentToken;

            if (this.match('LeftParens'))
                return this.parseParenthesizedExpression();

            if (this.match('Number', 'String', 'Identifier', 'True', 'False', 'None'))
                return [true, { type: token.type, value: this.getValue(token) }];

            if (this.match('LeftSquare'))
                return parseArray();

            if (this.match('LeftCurly'))
                return parseObject();

            this.addError(`Expected a primary expression: Number, String, Identifier, True, False, Array literal, Object literal or None, but found ${token.type}`, token);
            return [false];
        }

        return assignment();
    }

    parseDef() {
        const node = { type: 'Def', name: null, params: [], body: [] };

        {
            const [success, identifier] = this.parseIdentifier();

            if (!success) return [false];

            node.name = identifier.value;
        }

        if (!this.expect('LeftParens')) return [false];

        if (!this.match('RightParens'))
            while (true) {
                const [success, param] = this.parseIdentifier();

                if (!success) return [false];

                param.type = 'Param';

                if (this.match('Equal')) {
                    const [success, expr] = this.parseExpression();

                    if (!success) return [false];

                    param.default = expr;
                }

                node.params.push(param);

                if (this.match('RightParens'))
                    break;

                if (!this.expect('Comma')) return [false];
            }

        if (!this.expect('Colon')) return [false];

        {
            const [success, body] = this.parseBlock();

            if (!success) return [false];

            node.body = body;
        }

        return [true, node]; //If we reached here, the parsing succeeded
    }

    parseBlock() {
        if (this.match('NewLine'))
            return this.parseIndentedBlock();

        return this.parseInlineBlock();
    }

    parseIndentedBlock() {
        const node = { type: 'Block', statements: [] };

        if (!this.expect('Indent')) return [false];

        while (!this.isEOI) {
            const [success, statement] = this.parseStatement();

            if (!success) return [false];

            node.statements.push(statement);

            if (this.match('Dedent')) return [true, node];
        }

        return [false]; //We never matched the end dedent
    }

    parseInlineBlock() {
        const node = { type: 'Block', statements: [] };

        while (!this.isEOI) {
            const [success, statement] = this.parseStatement(true);

            if (!success) return [false];

            node.statements.push(statement);

            if (this.match('NewLine')) return [true, node]; //NewLine marks the end of the inline block

            if (!this.isEOI && !this.expect('Semicolon')) return [false];
        }

        return [true, node]; //If we reached end of input, the inline block is still valid
    }

    parseIf() {
        const node = { type: 'If' };

        {
            const [success, condition] = this.parseExpression();
            if (!success) return [false];
            node.condition = condition;
        }

        if (!this.expect('Colon')) return [false];

        {
            const [success, then] = this.parseBlock();
            if (!success) return [false];
            node.then = then;
        }

        if (this.match('Else')) {
            const [success, elseStmt] = this.parseStatement();
            if (!success) return [false];
            node.else = elseStmt;
        }

        return [true, node]; //If we reached here, the parsing succeeded.
    }

    parseExpressionStatement(isInline) {
        const [success, expr] = this.parseExpression();

        if (!success) return [false];

        if (!isInline && !this.isEOI)
            if (!this.expect('NewLine', 'Semicolon')) return [false];

        return [true, expr];
    }

    parseWhile() {
        const node = { type: 'While', condition: null, body: [] };

        {
            const [success, condition] = this.parseExpression();
            if (!success) return [false];
            node.condition = condition;
        }

        if (!this.expect('Colon')) return [false];

        {
            const [success, body] = this.parseBlock();
            if (!success) return [false];
            node.body = body;
        }

        return [true, node];
    }

    parseStatement(isInline = false) {
        if (this.match('NewLine')) return [true, { type: 'Empty' }];

        if (this.check('Indent'))
            return this.parseIndentedBlock();
        else if (this.match('Def'))
            return this.parseDef();
        else if (this.match('If'))
            return this.parseIf();
        else if (this.match('While'))
            return this.parseWhile();
        else if (this.match('Return')) {
            const [success, expression] = this.parseExpressionStatement(isInline);
            if (!success) return [false];
            return [true, { type: 'Return', expression }];
        }
        else
            return this.parseExpressionStatement(isInline);
    }

    //TODO: Rewrite panic to sync syntax borders.
    panic() { this.currentToken = { type: 'EndOfInput' }; }

    parse() {
        const statements = [];

        while (!this.isEOI) {
            const [success, node] = this.parseStatement();

            if (!success) //AHHHH
            {
                this.panic();
                continue;
            }

            if (node.type !== 'Empty')
                statements.push(node);
        }

        return [this.errors.length === 0, { type: 'Program', statements }];
    }

    interpret() {
        this.tokenizer = new Tokenizer(this.source);
        this.currentToken = this.tokenizer.next();
        this.ast = this.parse();

        //TODO: Replace this with actual interpretation.
        return this.ast;
    }
}

module.exports = Compiler;