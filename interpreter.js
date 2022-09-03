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