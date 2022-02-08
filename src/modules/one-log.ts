import { Logger } from 'winston';

export class OneLog {
  private marks: string[] = [];

  constructor (private readonly logger: Logger) {}

  async send(level: string, mark: string, message: string) {
    if (!this.marks.includes(mark)) {
      this.logger.log({ level, message });
      this.marks.push(mark);
    }
  }

  async clear() {
    this.marks = [];
  }
}
