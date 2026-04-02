#!/usr/bin/env node
import { existsSync, statSync } from 'node:fs';
import * as path from 'node:path';
import { parseArgs } from 'node:util';
import { pack } from './core/packer.js';
import { buildProject } from './core/unpacker.js';
import { OUT_DEFAULT } from './constants.js';
import { o, err } from './utils/logger.js';
async function main() {
    const { values, positionals } = parseArgs({
        options: {
            build: { type: 'boolean', short: 'b' },
            output: { type: 'string', short: 'o' },
            help: { type: 'boolean', short: 'h' }
        },
        allowPositionals: true
    });
    if (values.help) {
        console.log(`
Usage: codefile [options] [directory]

Pack a project directory into a single structured text file for LLM context.

Options:
  -b, --build       Reconstruct project from the pack file (default: ${OUT_DEFAULT} in cwd)
  -o, --output      Pack mode: output file path (default: <directory>/${OUT_DEFAULT})
                    Build mode: pack file to read from (default: ./${OUT_DEFAULT})
  -h, --help        Show this help message

Examples:
  codefile                        Pack the current directory
  codefile /path/to/project       Pack a specific directory
  codefile . -o context.txt       Write output to a custom path
  codefile --build                Reconstruct project from CodeFile.txt
  codefile --build -o archive.txt Reconstruct from a custom pack file
        `);
        return;
    }
    if (values.build) {
        const inPath = values.output ? path.resolve(values.output) : path.join(process.cwd(), OUT_DEFAULT);
        await buildProject(inPath);
        return;
    }
    const dir = positionals[0] || '.';
    const root = path.resolve(dir);
    if (!existsSync(root) || !statSync(root).isDirectory()) {
        err(o(`Fatal: ${root} is not a directory.`));
        process.exit(1);
    }
    const outPath = values.output ? path.resolve(values.output) : path.join(root, OUT_DEFAULT);
    // @ts-ignore
    const scriptPath = path.resolve(import.meta.url.replace('file://', ''));
    await pack(root, outPath, scriptPath);
}
main().catch(e => {
    err(o(`Critical failure: ${e}`));
    process.exit(1);
});
