const _cross = " +-";
const _corner = " +-";
const _vertical = " ¦ ";
const _space = "   ";

class Drawer {
    constructor(source, output) {
        this.source = source;
        this.output = output ?? process.stdout;
    }

    write(any) {
        if (typeof (any) !== 'string')
            any = JSON.stringify(any);

        this.output.write(any);
    }

    writeln(any) {
        this.write(any);
        this.write('\n');
    }

    draw(tree, indent = "") {
        this.write(' ' + tree.type);

        if (tree.value) {
            this.write(' = ');
            this.write(tree.value);
        }

        this.write('\n');

        const keys = Object.keys(tree).filter(k => k !== 'type');

        for (let i = 0; i < keys.length; i++) {
            const child = tree[keys[i]];
            const isLast = i == (keys.length - 1);

            if (Array.isArray(child)) {
                for (let j = 0; j < child.length; j += 1)
                    this.drawChild(child[j], indent, isLast);
            } else if (typeof (child) === 'object')
                this.drawChild(child, indent, isLast);
            //TODO: We ignore anything that is not array or object. Maybe add ?
        }
    }

    drawChild(node, indent, isLast) {
        this.write(indent);

        if (isLast) {
            this.write(_corner);
            indent += _space;
        } else {
            this.write(_cross);
            indent += _vertical;
        }

        this.draw(node, indent);
    }
}

module.exports = Drawer;