import * as path from 'path';
import * as fs from 'fs';

const sleep = async (ms: number): Promise<void> => {
  return new Promise(res => setTimeout(res, ms));
};

const issetError = async (): Promise<boolean> => {
  const errorFile = `${path.join(__dirname, '..', '..', 'logs')}/error.log`;

  return await new Promise(r => fs.access(errorFile, fs.constants.F_OK, (e) => r(!e)));
};

export { sleep, issetError };
