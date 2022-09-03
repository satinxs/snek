const regex = /( +)|(\r?\n)|([a-zA-Z_][\w]*)|(-?[0-9]+(\.[0-9]+)?)|("(\\"|[^"])*?")|(\()|(\))|(\[)|(\])|(\{)|(\})|(\.)|(,)|(=)|(;)|(:)|(<=)|(<)|(>=)|(>)|(\+=)|(\+)|(-=)|(-)|(\*=)|(\*)|(\/=)|(\/)|(#[^\n]*\r?(\n|(?!.)))|(.)/g;
const TokenTypes = ['Space', 'NewLine', 'Identifier', 'Number', null, 'String', null, 'LeftParens', 'RightParens', 'LeftSquare', 'RightSquare', 'LeftCurly', 'RightCurly', 'Dot', 'Comma', 'Equal', 'Semicolon', 'Colon', 'LeftAngleEqual', 'LeftAngle', 'RightAngleEqual', 'RightAngle', 'PlusEqual', 'Plus', 'DashEqual', 'Dash', 'StarEqual', 'Star', 'SlashEqual', 'Slash', 'Comment', null, 'Error'];
const keywords = Object.fromEntries(['and', 'break', 'continue', 'def', 'else', 'False', 'if', 'is', 'None', 'not', 'or', 'return', 'True', 'while'].map(k => [k, k.charAt(0).toUpperCase() + k.substring(1)]));

function* tokenize(state) {
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

const defer = (f, r) => { f(); return r; };

export class Parser {
    constructor(state) { this.state = state; }

    get isEOI() { return this.currentToken.type === 'EndOfInput'; }

    getValue({ position, length }) { return this.state.source.substring(position, position + length); }

    advance() { this.currentToken = this.state.tokenizer.next().value ?? { type: 'EndOfInput' }; }

    match(...types) {
        const token = this.currentToken;

        if (types.includes(token.type))
            return defer(() => this.advance(), token);

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

        return this.expect('RightParens') ? expression : [false];
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

        return this.expect('Identifier')
            ? [true, { type: 'Identifier', value: this.getValue(token) }]
            : [false];
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
                return success ? [true, { type: `Unary${token.type}`, expression }] : [false];
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

        if (this.match('Else') && this.expect('Colon')) {
            const [success, elseStmt] = this.parseBlock();
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

        const entries = this.variables.entries();

        for (const [k, v] of entries) {
            if (v.scope === id)
                this.variables.delete(k);
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

    indexSet(lvalue, rvalue) {
        const target = this.walk(lvalue.left);
        const key = lvalue.type === 'Index' ? lvalue.right.value : this.walk(lvalue.right);
        const value = this.walk(rvalue);

        if (typeof (target) !== 'object') throw new Error('Invalid target for object assign');

        target[key] = value;
    }

    getVariable(name) {
        if (!this.variables.has(name)) return null;

        return this.variables.get(name).value;
    }

    setVariable(name, value) {
        if (this.variables.has(name))
            this.variables.get(name).value = value;
        else {
            const scopedVariable = new Variable(this.scopeIndex, value);
            this.variables.set(name, scopedVariable);
        }
    }

    runBlock({ statements }) {
        this.startScope();

        for (const statement of statements)
            this.walk(statement);

        this.endScope();
    }

    assignment({ type, left, right }) {
        if (['Index', 'Member'].includes(left.type))
            this.indexSet(left, right);
        else if (left.type === 'Identifier') {
            this.setVariable(left.value, this.walk(right));
        } else
            throw new Error('Unexpected lvalue for assignment');
    }

    walk(node) {
        try {
            switch (node.type) {
                case 'Def': return this.createFunction(node);
                case 'Call': return this.callFunction(node);
                case 'Member': return this.index(node, true);
                case 'Index': return this.index(node);

                case 'Equal': return this.assignment(node);
                case 'Identifier': return this.getVariable(node.value);
                case 'Block': return this.runBlock(node);

                case 'Object': return this.createObject(node);
                case 'Array': return this.createArray(node);

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
        this.tokenizer = tokenize(this);
        this.parser = new Parser(this);
    }

    addError(message, { position, length }) { this.errors.push({ message, position, length }); }

    execute(runInterpreter = true) {
        const [success, program] = this.parser.parse();

        if (success) {
            this.ast = program;

            if (runInterpreter) {
                const interpreter = new TreeInterpreter();

                interpreter.setVariable('io', {
                    print: (...args) => console.log(...args)
                });

                for (const statement of program.statements)
                    interpreter.walk(statement);
            }
        } else
            this.addError("Failed parsing");
    }
}