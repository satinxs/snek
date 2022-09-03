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
                node.props.push([_getValue(key), expr]);
            } else //Yuck
                node.props.push([_getValue(key), _node('String', _getValue(key))]);

            if (_match('RightCurly')) return node;

            _expect('Comma');
        }
    };

    const _parseParenthesizedExpression = () => _defer(() => _expect('RightParens'), _parseExpression());

    const _parsePrimary = () => _switchMatch(
        () => _throw(`[Syntax] Expected a primary expression: Number, String, Identifier, True, False, Array literal, Object literal or None, but found ${currentToken.type}`, currentToken),
        [['LeftParens'], _parseParenthesizedExpression],
        [['Number', 'String', 'Identifier', 'True', 'False', 'None'], token => _node(token.type, _getValue(token))],
        [['LeftSquare'], _parseArray],
        [['LeftCurly'], _parseObject],
    );

    const _memberOrCall = () => {
        let node = _parsePrimary();
        while (true) {
            const r = _switchMatch(() => false,
                [['Dot'], () => _node('Member', node, _node('Identifier', _getValue(_expect('Identifier'))))],
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
        () => _memberOrCall(),
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

    const _parseInlineBlock = () => {
        const statements = [];
        while (!_isEOI()) {
            const statement = _parseStatement(true);
            if (statement.type !== 'Empty') statements.push(statement);
            if (_match('NewLine')) break;
            else _expect('Semicolon');
        }
        return _node('Block', ...statements);
    };

    const _parseIndentedBlock = (shouldExpectIndent = true) => {
        if (shouldExpectIndent) _expect('Indent');
        const statements = [];
        while (!_isEOI() && !_match('Dedent')) {
            const statement = _parseStatement();

            if (statement.type !== 'Empty') statements.push(statement);
        }
        return _node('Block', ...statements);
    };

    const _parseBlock = () => _match('NewLine') ? _parseIndentedBlock() : _parseInlineBlock();

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
        [['Indent'], () => _parseIndentedBlock(false)],
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

    return statements;
}