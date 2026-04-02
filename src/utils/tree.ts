/**
 * Builds a visual tree representation of the file structure.
 */
export function buildTree(rootName: string, relPaths: string[]): string {
    const tree: any = {};
    for (const p of relPaths.sort()) {
        let node = tree;
        for (const part of p.split('/')) {
            if (!node[part]) node[part] = {};
            node = node[part];
        }
    }

    const lines: string[] = [`${rootName}/`];

    function walk(node: any, prefix: string) {
        const entries = Object.entries(node).sort(([a, aNode]: any, [b, bNode]: any) => {
            const aIsDir = Object.keys(aNode).length > 0;
            const bIsDir = Object.keys(bNode).length > 0;
            if (aIsDir !== bIsDir) return bIsDir ? 1 : -1;
            return a.localeCompare(b);
        });

        for (let i = 0; i < entries.length; i++) {
            const [name, children] = entries[i];
            const last = i === entries.length - 1;
            const conn = last ? "\\-- " : "|-- ";
            const isDir = Object.keys(children as any).length > 0;
            lines.push(`${prefix}${conn}${name}${isDir ? '/' : ''}`);
            if (isDir) {
                walk(children, prefix + (last ? "    " : "|   "));
            }
        }
    }
    walk(tree, "");
    return lines.join('\n');
}
