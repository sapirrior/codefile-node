import { ORANGE, GREY, RESET } from '../constants.js';

export const o = (text: string) => `${ORANGE}${text}${RESET}`;
export const g = (text: string) => `${GREY}${text}${RESET}`;
export const err = (text: string) => process.stderr.write(`${ORANGE}${text}${RESET}\n`);
