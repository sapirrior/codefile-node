import { existsSync, readFileSync, statSync } from 'node:fs';
import * as path from 'node:path';
import { err } from '../utils/logger.js';

/**
 * Minimal glob matcher for .gitignore rules.
 */
function globToRegex(pattern: string, anchored: boolean): RegExp {
    let regex = pattern
        .replace(/\./g, '\\.')
        .replace(/\*\*/g, '(.+)')
        .replace(/\*/g, '([^/]+)')
        .replace(/\?/g, '(.)');

    if (anchored) {
        regex = '^' + regex + '(/.*)?$';
    } else {
        regex = '(^|/)' + regex + '(/.*)?$';
    }
    return new RegExp(regex);
}

export class GitignoreParser {
    private root: string;
    private rules: Array<{ negated: boolean, dirOnly: boolean, anchored: boolean, pattern: string, regex: RegExp }> = [];

    constructor(root: string) {
        this.root = root;
        this.load(path.join(root, '.gitignore'));
    }

    private load(gitignorePath: string) {
        if (!existsSync(gitignorePath)) return;
        try {
            const content = readFileSync(gitignorePath, 'utf8');
            for (let line of content.split(/\r?\n/)) {
                line = line.trim();
                if (!line || line.startsWith('#')) continue;

                let negated = line.startsWith('!');
                if (negated) line = line.substring(1);

                const dirOnly = line.endsWith('/');
                if (dirOnly) line = line.slice(0, -1);

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
        } catch (e) {
            err(`Warning: could not read .gitignore: ${e}`);
        }
    }

    isIgnored(filePath: string): boolean {
        const rel = path.relative(this.root, filePath).split(path.sep).join('/');
        const isDir = statSync(filePath).isDirectory();
        let matched = false;

        for (const rule of this.rules) {
            if (rule.dirOnly && !isDir) continue;

            const hit = rule.regex.test(rel);
            if (hit) {
                matched = !rule.negated;
            }
        }
        return matched;
    }
}
