import { createReadStream, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline';
import { o, g, err } from '../utils/logger.js';

export async function buildProject(inPath: string) {
    const root = process.cwd();
    if (!existsSync(inPath)) {
        err(o(`Fatal: ${inPath} not found.`));
        process.exit(1);
    }

    process.stdout.write(o(`Rebuilding project from ${path.basename(inPath)}...`) + "\n\n");

    let builtCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    const fileStream = createReadStream(inPath);
    const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
    });

    let currentFile: { rel: string, fid: string, targetPath: string, sentinelEnd: string } | null = null;
    let fileLines: string[] = [];
    let isSpecial = false;

    for await (const line of rl) {
        if (!currentFile) {
            if (line.startsWith("FILE_START ")) {
                const tokens = line.trim().split(" ");
                if (tokens.length < 3) {
                    err(`Error: Malformed FILE_START line: ${line}`);
                    errorCount++;
                    continue;
                }
                const fid = tokens[tokens.length - 1];
                const rel = tokens.slice(1, -1).join(" ");
                const targetPath = path.resolve(root, rel);

                if (!targetPath.startsWith(root)) {
                    err(`Warning: Path traversal detected for ${rel}. Skipped.`);
                    skippedCount++;
                    // Skip mode: wait for FILE_END
                    currentFile = { rel, fid, targetPath, sentinelEnd: `FILE_END ${rel} ${fid}` };
                    isSpecial = true; // effectively skip content
                    continue;
                }

                try {
                    mkdirSync(path.dirname(targetPath), { recursive: true });
                } catch (e) {
                    err(`Error: Could not create directory for ${rel} (${e}). Skipped.`);
                    errorCount++;
                    skippedCount++;
                    currentFile = { rel, fid, targetPath, sentinelEnd: `FILE_END ${rel} ${fid}` };
                    isSpecial = true;
                    continue;
                }

                currentFile = { rel, fid, targetPath, sentinelEnd: `FILE_END ${rel} ${fid}` };
                fileLines = [];
                isSpecial = false;
            }
            continue;
        }

        if (line.trim() === currentFile.sentinelEnd) {
            if (!isSpecial) {
                try {
                    const content = fileLines.join('\n');
                    writeFileSync(currentFile.targetPath, content);
                    process.stdout.write(o(` -> Extracted: ${currentFile.rel}\n`));
                    builtCount++;
                } catch (e) {
                    err(`Error: Failed to write ${currentFile.rel} (${e})`);
                    errorCount++;
                }
            }
            currentFile = null;
            continue;
        }

        if (fileLines.length === 0 && !isSpecial) {
            if (["SYMLINK_CONTENT", "EMPTY_CONTENT", "BINARY_CONTENT"].includes(line.trim())) {
                const marker = line.trim();
                if (marker === "EMPTY_CONTENT") {
                    try {
                        writeFileSync(currentFile.targetPath, '');
                        process.stdout.write(g(` -> Created empty: ${currentFile.rel}\n`));
                        builtCount++;
                    } catch (e) {
                        err(`Error: Could not create empty file ${currentFile.rel} (${e})`);
                        errorCount++;
                    }
                } else {
                    process.stdout.write(g(` -> Skipped special: ${currentFile.rel} (${marker})\n`));
                    skippedCount++;
                }
                isSpecial = true;
                continue;
            }
        }

        if (!isSpecial) {
            fileLines.push(line);
        }
    }

    process.stdout.write(`\n${o(`Build Complete: ${builtCount} files created, `)}${g(`${skippedCount} skipped, ${errorCount} errors.`)}\n`);
}
