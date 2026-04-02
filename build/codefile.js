#!/usr/bin/env node
import { promises as fs, createReadStream, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
const IO_CHUNK = 65536;
const BINARY_THRESHOLD = 8192;
const OUT_DEFAULT = "CodeFile.txt";
const ORANGE = "\x1b[38;5;173m";
const GREY = "\x1b[38;5;244m";
const RESET = "\x1b[0m";
const o = (text) => `${ORANGE}${text}${RESET}`;
const g = (text) => `${GREY}${text}${RESET}`;
const err = (text) => process.stderr.write(`${ORANGE}${text}${RESET}\n`);
/**
 * Detects if a file is binary based on its content.
 */
async function isBinary(filePath) {
    try {
        const handle = await fs.open(filePath, 'r');
        const buffer = Buffer.alloc(BINARY_THRESHOLD);
        const { bytesRead } = await handle.read(buffer, 0, BINARY_THRESHOLD, 0);
        await handle.close();
        if (bytesRead === 0)
            return false;
        const chunk = buffer.subarray(0, bytesRead);
        if (chunk.includes(0))
            return true;
        try {
            new TextDecoder('utf-8', { fatal: true }).decode(chunk);
            return false;
        }
        catch {
            // ignore
        }
        let highBytes = 0;
        for (let i = 0; i < bytesRead; i++) {
            if (chunk[i] > 127)
                highBytes++;
        }
        return (highBytes / bytesRead) > 0.30;
    }
    catch {
        return true;
    }
}
/**
 * Minimal glob matcher for .gitignore rules.
 */
function globToRegex(pattern, anchored) {
    let regex = pattern
        .replace(/\./g, '\\.')
        .replace(/\*\*/g, '(.+)')
        .replace(/\*/g, '([^/]+)')
        .replace(/\?/g, '(.)');
    if (anchored) {
        regex = '^' + regex + '(/.*)?$';
    }
    else {
        regex = '(^|/)' + regex + '(/.*)?$';
    }
    return new RegExp(regex);
}
class GitignoreParser {
    root;
    rules = [];
    constructor(root) {
        this.root = root;
        this.load(path.join(root, '.gitignore'));
    }
    load(gitignorePath) {
        if (!existsSync(gitignorePath))
            return;
        try {
            const content = readFileSync(gitignorePath, 'utf8');
            for (let line of content.split(/\r?\n/)) {
                line = line.trim();
                if (!line || line.startsWith('#'))
                    continue;
                let negated = line.startsWith('!');
                if (negated)
                    line = line.substring(1);
                const dirOnly = line.endsWith('/');
                if (dirOnly)
                    line = line.slice(0, -1);
                let anchored = line.includes('/') && line.indexOf('/') !== line.length - 1;
                if (line.startsWith('/')) {
                    line = line.substring(1);
                    anchored = true;
                }
                this.rules.push({
                    negated,
                    dirOnly,
                    anchored,
                    pattern: line,
                    regex: globToRegex(line, anchored)
                });
            }
        }
        catch (e) {
            err(`Warning: could not read .gitignore: ${e}`);
        }
    }
    isIgnored(filePath) {
        const rel = path.relative(this.root, filePath).split(path.sep).join('/');
        const isDir = statSync(filePath).isDirectory();
        let matched = false;
        for (const rule of this.rules) {
            if (rule.dirOnly && !isDir)
                continue;
            const hit = rule.regex.test(rel);
            if (hit) {
                matched = !rule.negated;
            }
        }
        return matched;
    }
}
function buildTree(rootName, relPaths) {
    const tree = {};
    for (const p of relPaths.sort()) {
        let node = tree;
        for (const part of p.split('/')) {
            if (!node[part])
                node[part] = {};
            node = node[part];
        }
    }
    const lines = [`${rootName}/`];
    function walk(node, prefix) {
        const entries = Object.entries(node).sort(([a, aNode], [b, bNode]) => {
            const aIsDir = Object.keys(aNode).length > 0;
            const bIsDir = Object.keys(bNode).length > 0;
            if (aIsDir !== bIsDir)
                return bIsDir ? 1 : -1;
            return a.localeCompare(b);
        });
        for (let i = 0; i < entries.length; i++) {
            const [name, children] = entries[i];
            const last = i === entries.length - 1;
            const conn = last ? "\\-- " : "|-- ";
            const isDir = Object.keys(children).length > 0;
            lines.push(`${prefix}${conn}${name}${isDir ? '/' : ''}`);
            if (isDir) {
                walk(children, prefix + (last ? "    " : "|   "));
            }
        }
    }
    walk(tree, "");
    return lines.join('\n');
}
async function hashFile(filePath) {
    const hash = createHash('sha256');
    try {
        const stream = createReadStream(filePath);
        for await (const chunk of stream) {
            hash.update(chunk);
        }
    }
    catch {
        return "error0000000";
    }
    return hash.digest('hex').substring(0, 12);
}
async function pack(root, outPath, scriptPath) {
    const gi = new GitignoreParser(root);
    const outResolved = path.resolve(outPath);
    const scriptResolved = path.resolve(scriptPath);
    const packed = [];
    let totalBytes = 0;
    let skippedCount = 0;
    process.stdout.write(o(`Scanning: ${path.basename(root)}/\n`));
    async function walkDir(currentDir) {
        const entries = await fs.readdir(currentDir, { withFileTypes: true });
        for (const entry of entries) {
            const fp = path.join(currentDir, entry.name);
            const rel = path.relative(root, fp).split(path.sep).join('/');
            if (entry.name === '.git')
                continue;
            if (gi.isIgnored(fp)) {
                skippedCount++;
                continue;
            }
            if (path.resolve(fp) === outResolved || path.resolve(fp) === scriptResolved) {
                skippedCount++;
                continue;
            }
            if (entry.isSymbolicLink()) {
                packed.push({ fp, rel });
                continue;
            }
            if (entry.isDirectory()) {
                await walkDir(fp);
                continue;
            }
            if (entry.isFile()) {
                const stats = await fs.stat(fp);
                totalBytes += stats.size;
                packed.push({ fp, rel });
            }
            else {
                skippedCount++;
            }
        }
    }
    await walkDir(root);
    process.stdout.write(g(`Packing ${packed.length} files (${(totalBytes / (1024 * 1024)).toFixed(2)} MB source), ${skippedCount} skipped.\n`));
    const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    const treeStr = buildTree(path.basename(root), packed.map(p => p.rel));
    let writeErrors = 0;
    mkdirSync(path.dirname(outPath), { recursive: true });
    const outBuffer = [];
    outBuffer.push(`ROOT_NAME ${path.basename(root)}\n`);
    outBuffer.push(`CREATED_UTC ${timestamp}\n`);
    outBuffer.push(`TOTAL_SOURCE_MB ${(totalBytes / (1024 * 1024)).toFixed(2)}\n`);
    outBuffer.push(`FILE_COUNT ${packed.length}\n\n`);
    outBuffer.push(`START_STRUCTURE\n${treeStr}\nEND_STRUCTURE\n\n`);
    for (const { fp, rel } of packed) {
        try {
            const stats = await fs.lstat(fp);
            if (stats.isSymbolicLink()) {
                const fid = "symlink00000";
                outBuffer.push(`FILE_START ${rel} ${fid}\n`);
                outBuffer.push("SYMLINK_CONTENT");
                outBuffer.push(`\nFILE_END ${rel} ${fid}\n\n`);
                continue;
            }
            const size = stats.size;
            if (size === 0) {
                const fid = "empty000000";
                outBuffer.push(`FILE_START ${rel} ${fid}\n`);
                outBuffer.push("EMPTY_CONTENT");
                outBuffer.push(`\nFILE_END ${rel} ${fid}\n\n`);
                continue;
            }
            if (await isBinary(fp)) {
                const fid = await hashFile(fp);
                outBuffer.push(`FILE_START ${rel} ${fid}\n`);
                outBuffer.push("BINARY_CONTENT");
                outBuffer.push(`\nFILE_END ${rel} ${fid}\n\n`);
                continue;
            }
            const fid = await hashFile(fp);
            outBuffer.push(`FILE_START ${rel} ${fid}\n`);
            const content = await fs.readFile(fp, 'utf8');
            outBuffer.push(content);
            outBuffer.push(`\nFILE_END ${rel} ${fid}\n\n`);
        }
        catch (e) {
            err(`Warning: skipped ${rel}: ${e}`);
            writeErrors++;
        }
    }
    await fs.writeFile(outPath, outBuffer.join(''), 'utf8');
    const outStats = await fs.stat(outPath);
    let msg = o(`Done. ${path.basename(outPath)} written (${(outStats.size / (1024 * 1024)).toFixed(2)} MB).`);
    if (writeErrors) {
        msg += " " + g(`${writeErrors} file(s) had read errors.`);
    }
    process.stdout.write(msg + '\n');
}
async function buildProject(inPath) {
    const root = path.dirname(path.resolve(inPath));
    if (!existsSync(inPath)) {
        err(o(`Fatal: ${inPath} not found.`));
        process.exit(1);
    }
    process.stdout.write(o(`Rebuilding project from ${path.basename(inPath)}...`) + "\n\n");
    let builtCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    try {
        const content = await fs.readFile(inPath, 'utf8');
        const lines = content.split('\n');
        let i = 0;
        while (i < lines.length) {
            let line = lines[i];
            if (!line.startsWith("FILE_START ")) {
                i++;
                continue;
            }
            const tokens = line.trim().split(" ");
            if (tokens.length < 3) {
                err(`Error: Malformed FILE_START line: ${line}`);
                errorCount++;
                i++;
                continue;
            }
            const fid = tokens[tokens.length - 1];
            const rel = tokens.slice(1, -1).join(" ");
            const sentinelEnd = `FILE_END ${rel} ${fid}`;
            if (!rel) {
                err(`Error: Empty path in FILE_START line: ${line}`);
                errorCount++;
                i++;
                continue;
            }
            const targetPath = path.resolve(root, rel);
            if (!targetPath.startsWith(root)) {
                err(`Warning: Path traversal detected for ${rel}. Skipped.`);
                skippedCount++;
                while (i < lines.length && lines[i].trim() !== sentinelEnd)
                    i++;
                i++;
                continue;
            }
            try {
                mkdirSync(path.dirname(targetPath), { recursive: true });
            }
            catch (e) {
                err(`Error: Could not create directory for ${rel} (${e}). Skipped.`);
                errorCount++;
                skippedCount++;
                while (i < lines.length && lines[i].trim() !== sentinelEnd)
                    i++;
                i++;
                continue;
            }
            if (existsSync(targetPath)) {
                process.stdout.write(g(`Notice: Overwriting existing file: ${rel}\n`));
            }
            i++;
            line = lines[i];
            let isSpecial = false;
            if (line && ["SYMLINK_CONTENT", "EMPTY_CONTENT", "BINARY_CONTENT"].includes(line.trim())) {
                const specialMarker = line.trim();
                const nextLine = lines[i + 1];
                if (nextLine && nextLine.trim() === sentinelEnd) {
                    isSpecial = true;
                    if (specialMarker === "EMPTY_CONTENT") {
                        try {
                            await fs.writeFile(targetPath, '');
                            process.stdout.write(g(` -> Created empty: ${rel}\n`));
                            builtCount++;
                        }
                        catch (e) {
                            err(`Error: Could not create empty file ${rel} (${e})`);
                            errorCount++;
                        }
                    }
                    else {
                        process.stdout.write(g(` -> Skipped special: ${rel} (${specialMarker})\n`));
                        skippedCount++;
                    }
                    i += 2;
                }
            }
            if (!isSpecial) {
                try {
                    const fileContent = [];
                    while (i < lines.length && lines[i].trim() !== sentinelEnd) {
                        fileContent.push(lines[i]);
                        i++;
                    }
                    if (i < lines.length && lines[i].trim() === sentinelEnd) {
                        // Join content, but be careful with the last newline which might belong to the sentinel
                        let finalContent = fileContent.join('\n');
                        // In the Python version, it handles the last newline carefully.
                        // Here, if the file was text, it should be fine.
                        await fs.writeFile(targetPath, finalContent);
                        process.stdout.write(o(` -> Extracted: ${rel}\n`));
                        builtCount++;
                        i++;
                    }
                    else {
                        err(`Warning: Unexpected EOF while reading ${rel}.`);
                        errorCount++;
                    }
                }
                catch (e) {
                    err(`Error: Failed to write ${rel} (${e})`);
                    errorCount++;
                    skippedCount++;
                }
            }
        }
    }
    catch (e) {
        err(o(`Critical Error: Could not read ${path.basename(inPath)} ({e})`));
        process.exit(1);
    }
    process.stdout.write(`\n${o(`Build Complete: ${builtCount} files created, `)}${g(`${skippedCount} skipped, ${errorCount} errors.`)}\n`);
}
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
