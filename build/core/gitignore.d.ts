export declare class GitignoreParser {
    private root;
    private rules;
    constructor(root: string);
    private load;
    isIgnored(filePath: string): boolean;
}
