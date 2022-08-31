//Utility functions
const defer = (f, r) => { f(); return r; };
const escapeRegExp = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
const k = str => new RegExp(`^(${str})(?!\\w)`); //Keyword
const r = str => new RegExp('^' + escapeRegExp(str)); //Escaped regex

//Order of the TokenTypes is important.
const TokenTypes = {
    Def: k('def'), If: k('if'), Else: k('else'), While: k('while'), Return: k('return'), Break: k('break'), Continue: k('continue'),
    IsNot: k('is\\s+not'), Or: k('or'), And: k('and'), Is: k('is'), Not: k('not'),
    True: k('True'), False: k('False'), None: k('None'), Number: /^-?[0-9]+(\.[0-9]+)?/,
    LeftParens: r('('), RightParens: r(')'), LeftSquare: r('['), RightSquare: r(']'), LeftCurly: r('{'), RightCurly: r('}'),
    LeftAngleEqual: r('<='), RightAngleEqual: r('>='), StarEqual: r('*='), SlashEqual: r('/='), PlusEqual: r('+='), DashEqual: r('-='),
    Star: r('*'), Slash: r('/'), Plus: r('+'), Dash: r('-'), LeftAngle: r('<'), RightAngle: r('>'),
    Comma: r(','), Dot: r('.'), Colon: r(':'), Semicolon: r(';'), Equal: r('='),
    String: /^(['"])(.*?)\1/, Identifier: /^[a-zA-Z_][\w]*(?![\w])/,
    Space: /^ +/, NewLine: /^\r?\n/, Comment: /^#[^\n]*\r?(\n|(?!.))/,
    Error: /^./
};

export class Tokenizer {
    position = 0; indentation = 0;
    isNewLine = true; queue = [];
    constructor(state) { this.state = state; this.source = state.source; this.input = state.source; }

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
        if (diff % 4 !== 0) {
            this.state.addError(`[Lexical] Bad indentation: Indentation should be multiple of 4, found ${Math.abs(diff)}`, { position, length: Math.abs(diff) });
            return { type: 'Error', position, length: Math.abs(diff) };
        }

        const type = diff < 0 ? 'Dedent' : 'Indent';
        for (let i = 0; i < Math.abs(diff) / 4; i += 1)
            this.queue.push({ type, position: position + i, length: 4 });

        this.indentation += diff;
        return this.queue.shift();
    }

    next() {
        if (this.queue.length > 0) return this.queue.shift();
        if (this.input.length === 0) return { type: 'EndOfInput' };

        let token;
        while (token = this._next()) {
            if (this.isNewLine && token.type !== 'Comment') {
                if (token.type === 'NewLine') continue;

                this.isNewLine = false;

                if (token.type === 'Space') {
                    if (this.indentation === token.length) continue;
                    return this._processIndentation(token.position, token.length - this.indentation);
                } else if (this.indentation > 0) {
                    return defer(
                        () => this.queue.push(token),
                        this._processIndentation(token.position, -this.indentation)
                    );
                }
            }

            this.isNewLine = token.type === 'NewLine';

            if (!['Space', 'Comment'].includes(token.type))
                return token;
        }

        //Emit a dedent at the end of the file if needed
        if (this.indentation > 0) return this._processIndentation(this.source.length - 1, -this.indentation);

        return { type: 'EndOfInput' }; //We needed to ignore all of the last tokens.
    }
}

export class Parser {
    constructor(state) { this.state = state; }

    get isEOI() { return this.currentToken.type === 'EndOfInput'; }

    getValue({ position, length }) { return this.state.source.substring(position, position + length); }

    advance() { this.currentToken = this.state.tokenizer.next(); }

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

        if (!token) this.state.addError(`[Syntax] Expected ${types}, found ${this.currentToken.type}`, this.currentToken);

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

            this.state.addError(`[Syntax] Expected a primary expression: Number, String, Identifier, True, False, Array literal, Object literal or None, but found ${token.type}`, token);
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

            if (statement.type !== 'Empty') node.statements.push(statement);

            if (this.match('Dedent')) return [true, node];
        }

        return [false]; //We never matched the end dedent
    }

    parseInlineBlock() {
        const node = { type: 'Block', statements: [] };

        while (!this.isEOI) {
            const [success, statement] = this.parseStatement(true);

            if (!success) return [false];

            if (statement.type !== 'Empty') node.statements.push(statement);

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

    parseReturn(isInline) {
        const [success, expression] = this.parseExpressionStatement(isInline);
        if (!success) return [false];
        return [true, { type: 'Return', expression }];
    }

    parseStatement(isInline = false) {
        if (this.match('NewLine')) return [true, { type: 'Empty' }];

        if (this.check('Indent')) return this.parseIndentedBlock();
        else if (this.match('Def')) return this.parseDef();
        else if (this.match('If')) return this.parseIf();
        else if (this.match('While')) return this.parseWhile();
        else if (this.match('Return')) return this.parseReturn(isInline);
        else if (this.match('Break')) return { type: 'Break' };
        else if (this.match('Continue')) return { type: 'Continue' };
        else return this.parseExpressionStatement(isInline);
    }

    //TODO: Rewrite panic to sync syntax borders.
    panic() { this.currentToken = { type: 'EndOfInput' }; }

    parse() {
        this.advance();

        const statements = [];

        while (!this.isEOI) {
            const [success, node] = this.parseStatement();

            if (!success) { this.panic(); continue; } //AHHHH

            if (node.type !== 'Empty') statements.push(node);
        }

        return [this.state.errors.length === 0, { type: 'Program', statements }];
    }
}

class Variable { constructor(scope, value) { this.scope = scope; this.value = value; } }

export class TreeInterpreter {
    stack = [];
    variables = new Map();

    scope = [new Map()];
    scopeIndex = 0;
    get currentScope() { return this.scope[this.scope.length - 1]; }

    startScope() { this.scopeIndex += 1; }

    endScope() {
        const id = this.scopeIndex;

        for (const variable of this.variables.values()) {
            if (variable[variable.length - 1].scope === id)
                variable.pop(); //If the variable has a scoped definition, pop it.
        }

        this.scopeIndex -= 1;
    }

    createFunction(node) {
        const { name, params, body } = node;
    }

    callFunction(node) {
        const func = this.walk(node.func);

        const args = [];
        for (const arg of node.args)
            args.push(this.walk(arg));

        if (typeof (func) === 'function')
            func(...args);
        else {

        }
    }

    index(node, isMember = false) {
        const left = this.walk(node.left);

        const right = isMember
            ? node.right.value //Right will be an identifier.
            : this.walk(node.right);

        //TODO: Validate left is object and throw with correct source location
        return left[right];
    }

    getVariable(name) {
        if (!this.variables.get(name)) return null;

        const variable = this.variables.get(name);

        return variable[variable.length - 1].value;
    }

    setVariable(name, value) {
        const scopedVariable = new Variable(this.scopeIndex, value);

        if (!this.variables.has(name))
            this.variables.set(name, [scopedVariable]);
        else {
            const variable = this.variables.get(name);
            variable.push(scopedVariable);
        }
    }

    runBlock({ statements }) {
        this.startScope();

        for (const statement of statements)
            this.walk(statement);

        this.endScope();
    }

    assignment({ type, left, right }) {
        if (['Index', 'Member'].includes(left.type)) {

        }
    }

    walk(node) {
        try {
            switch (node.type) {
                case 'Def': return this.createFunction(node);
                case 'Call': return this.callFunction(node);
                case 'Member': return this.index(node, true);
                case 'Index': return this.index(node);

                case 'Equal': return this.assignment(node);
                case 'Identifier': return this.getVariable(node);
                case 'Block': return this.runBlock(node);

                //Values
                case 'String': return node.value;
                case 'Number': return parseFloat(node.value);
                case 'True': return true;
                case 'False': return false;
                case 'None': return null;
                default:
                // throw new Error(`Unexpected AST node = "${JSON.stringify(node)}"`);
            }
        } catch (error) {
            console.log('Encountered an error when executing your program.');
            console.log(error);
        }
    }
}

export default class Snek {
    errors = [];
    constructor(source) {
        this.source = source;
        this.tokenizer = new Tokenizer(this);
        this.parser = new Parser(this);
    }

    addError(message, { position, length }) { this.errors.push({ message, position, length }); }

    execute() {
        const [success, program] = this.parser.parse();

        if (success) {
            const interpreter = new TreeInterpreter();

            interpreter.variables.set('io', {
                print: (...args) => console.log(...args)
            });

            for (const statement of program.statements)
                interpreter.walk(statement);
        }
    }
}