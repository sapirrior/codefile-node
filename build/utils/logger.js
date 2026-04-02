import { ORANGE, GREY, RESET } from '../constants.js';
export const o = (text) => `${ORANGE}${text}${RESET}`;
export const g = (text) => `${GREY}${text}${RESET}`;
export const err = (text) => process.stderr.write(`${ORANGE}${text}${RESET}\n`);
